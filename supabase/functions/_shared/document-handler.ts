import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { imageQuality } from './image-quality.ts';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const kinds = ['NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME','ID PHOTO'];
const bucket = 'applicant-documents';
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
async function boundedBody(req: Request) {
  const reader = req.body?.getReader(); if (!reader) throw Error('Missing request body.');
  const parts: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 12 * 1024 * 1024) { await reader.cancel(); throw Error('Maximum file size is 10 MB.'); } parts.push(value); }
  return new Blob(parts);
}
export function documentHandler(mode: 'staff' | 'invitation') {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return respond({ error: 'Use POST.' }, 405);
    try {
      const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
      const key = keys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (!key) throw Error('Private document storage is not configured.');
      const client = createClient(Deno.env.get('SUPABASE_URL')!, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const contentType = req.headers.get('content-type') || '';
      const body = await boundedBody(req);
      if (!contentType.includes('multipart/form-data')) {
        const input = JSON.parse(await body.text());
        if (mode === 'invitation' && input.action !== 'preview' || mode === 'staff' && !['preview','download','delete'].includes(input.action)) throw Error('Unknown document action.');
        const { data: document, error: denied } = mode === 'staff'
          ? await client.rpc('ats_document_access', { p_session_token: input.sessionToken, p_applicant_id: null, p_document_id: input.documentId })
          : await client.rpc('ats_application_document_access', { p_token: input.invitationToken, p_document_id: input.documentId });
        if (denied) throw denied;
        if (input.action === 'delete') {
          const { error: removed } = await client.storage.from(bucket).remove([document.storage_path]); if (removed) throw removed;
          const { error: recordError } = await client.rpc('ats_document_remove', { p_session_token: input.sessionToken, p_document_id: input.documentId }); if (recordError) throw recordError;
          return respond({ removed: true });
        }
        const inline = input.action === 'preview' && ['application/pdf','image/png','image/jpeg'].includes(document.mime_type);
        const { data, error } = await client.storage.from(bucket).createSignedUrl(document.storage_path, 60, inline ? {} : { download: document.filename });
        if (error) throw error;
        return respond({ url: data.signedUrl, filename: document.filename, mime_type: document.mime_type, previewable: inline });
      }
      const form = await new Response(body, { headers: { 'content-type': contentType } }).formData();
      const sessionToken = String(form.get('sessionToken') || '');
      const invitationToken = String(form.get('invitationToken') || '');
      const kind = String(form.get('documentType') || ''), file = form.get('file');
      if (!kinds.includes(kind) || !(file instanceof File)) throw Error('Choose a valid document category and file.');
      const { data: access, error: denied } = mode === 'staff'
        ? await client.rpc('ats_document_access', { p_session_token: sessionToken, p_applicant_id: String(form.get('applicantId') || ''), p_document_id: null })
        : await client.rpc('ats_application_upload_access', { p_token: invitationToken });
      if (denied) throw denied;
      if (access.expired) return respond({ error: 'The requirements deadline has passed. Uploads are closed for HR review.', expired: true }, 410);
      if (mode === 'invitation' && !access.can_upload.includes(kind)) throw Error('This category is already submitted. A recruiter must reject it before replacement.');
      if (file.size < 1 || file.size > 10485760) throw Error('Each file must be between 1 byte and 10 MB.');
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const mime: Record<string,string> = { pdf:'application/pdf', jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', doc:'application/msword', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
      if (!mime[ext] || kind === 'ID PHOTO' && !['jpg','jpeg','png'].includes(ext)) throw Error(kind === 'ID PHOTO' ? 'Upload a square JPG or PNG 1×1 ID picture.' : 'Upload PDF, JPG, PNG, DOC or DOCX documents.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const starts = (signature: number[]) => signature.every((value, index) => bytes[index] === value);
      const valid = ext === 'pdf' ? starts([37,80,68,70,45]) : ext === 'png' ? starts([137,80,78,71,13,10,26,10]) : ['jpg','jpeg'].includes(ext) ? starts([255,216,255]) : ext === 'doc' ? starts([208,207,17,224,161,177,26,225]) : starts([80,75,3,4]);
      if (!valid) throw Error('The file content does not match its extension.');
      const quality = imageQuality(bytes, ext, kind === 'ID PHOTO');
      const id = crypto.randomUUID(), path = access.admin_id + '/' + access.applicant_id + '/' + id + '.' + ext;
      const { error: uploaded } = await client.storage.from(bucket).upload(path, bytes, { contentType: mime[ext], upsert: false }); if (uploaded) throw uploaded;
      const { data: saved, error: saveError } = await client.rpc('ats_document_upload_record', {
        p_session_token: mode === 'staff' ? sessionToken : null, p_token: mode === 'invitation' ? invitationToken : null,
        p_applicant_id: mode === 'staff' ? access.applicant_id : null, p_id: id, p_document_type: kind,
        p_filename: file.name.replace(/[\u0000-\u001f\u007f/\\]/g,'_').slice(0,180), p_mime_type: mime[ext], p_byte_size: file.size, p_storage_path: path, p_quality: quality,
      });
      if (saveError || !saved?.saved) {
        await client.storage.from(bucket).remove([path]);
        if (saveError) throw saveError;
        return respond({error:saved?.error||'The upload window is closed for HR review.',expired:Boolean(saved?.expired)},410);
      }
      return respond(saved);
    } catch (reason) {
      const error = reason as { message?: string; code?: string };
      return respond({ error: error.message || 'Document request failed.' }, error.code === '28000' ? 401 : error.code === '42501' ? 403 : 400);
    }
  };
}
