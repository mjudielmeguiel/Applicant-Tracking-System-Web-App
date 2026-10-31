import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function boundedBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw Error('Missing upload body.');
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 12 * 1024 * 1024) { await reader.cancel(); throw Error('Maximum file size is 10 MB.'); }
    parts.push(value);
  }
  return new Blob(parts);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return respond({ error: 'Use POST.' }, 405);
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    const key = keys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!key) throw Error('Requirements storage is not configured.');
    const client = createClient(Deno.env.get('SUPABASE_URL')!, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) throw Error('Choose a document file to upload.');
    const form = await new Response(await boundedBody(req), { headers: { 'content-type': contentType } }).formData();
    const token = String(form.get('invitationToken') || '');
    const kind = String(form.get('documentType') || '');
    const file = form.get('file');
    // The server derives the owner and applicant from the invitation, never from
    // caller-supplied IDs. Both access and registration validate the capability.
    const { data: access, error: denied } = await client.rpc('ats_application_upload_access', { p_token: token });
    if (denied) throw denied;
    if (!access.required.includes(kind) || !(file instanceof File)) throw Error('Choose a valid requirement category and file.');
    if (file.size < 1 || file.size > 10485760) throw Error('Each document must be between 1 byte and 10 MB.');
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const mime: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    if (!mime[ext]) throw Error('Upload PDF, JPG, PNG, DOC or DOCX documents.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const starts = (signature: number[]) => signature.every((v, i) => bytes[i] === v);
    const valid = ext === 'pdf' ? starts([37,80,68,70,45]) : ext === 'png' ? starts([137,80,78,71,13,10,26,10]) : ['jpg','jpeg'].includes(ext) ? starts([255,216,255]) : ext === 'doc' ? starts([208,207,17,224,161,177,26,225]) : starts([80,75,3,4]);
    if (!valid) throw Error('The document content does not match its file extension.');
    const id = crypto.randomUUID();
    const path = access.admin_id + '/' + access.applicant_id + '/' + id + '.' + ext;
    const filename = file.name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 180);
    const { error: uploadError } = await client.storage.from('applicant-documents').upload(path, bytes, { contentType: mime[ext], upsert: false });
    if (uploadError) throw uploadError;
    const { data: saved, error: saveError } = await client.rpc('ats_application_document_register', { p_token: token, p_id: id, p_document_type: kind, p_filename: filename, p_mime_type: mime[ext], p_byte_size: file.size, p_storage_path: path });
    if (saveError) {
      await client.storage.from('applicant-documents').remove([path]);
      throw saveError;
    }
    return respond(saved);
  } catch (reason) {
    const error = reason as { message?: string; code?: string };
    return respond({ error: error.message || 'Requirements upload failed.' }, error.code === '28000' ? 401 : error.code === '42501' ? 403 : 400);
  }
});
