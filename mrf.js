(async function () {
  'use strict';
  if (!await window.ATS.ready) return;
  await window.ATS.catalogReady;
  const A = window.ATS;
  const S = window.MRFStore;
  const $ = id => document.getElementById(id);
  const esc = A.escape;
  const fields = S && Array.isArray(S.fields) ? S.fields : [];
  const primary = fields.find(field => field.primary) || fields.find(field => field.key === 'MRFID') || fields[0];
  const sheetField = fields.find(field => field.key === 'ExcelSheet');
  const statusField = fields.find(field => field.key === 'STATUS');
  const siteField = fields.find(field => field.key === 'Site');
  const dateFields = fields.filter(field => field.type === 'date' || field.type === 'datetime');
  const editableFields = fields.filter(field => !field.readOnly && !field.primary);
  const hiddenColumns = new Set();
  const groupNames = { source: 'Source & identity', requisition: 'Requisition details', deployment: 'Deployment', metrics: 'Hiring metrics', feedback: 'Feedback & follow-up', import: 'Workbook source', system: 'System information' };
  const groupOrder = ['source', 'requisition', 'deployment', 'metrics', 'feedback', 'import', 'system'];
  let records = [];
  let filtered = [];
  let page = 1;
  let sortKey = primary ? primary.key : '';
  let sortDirection = 1;
  let loading = false;
  let loaded = false;
  let saving = false;
  let editingRecord = null;
  let formInitial = {};
  let lastSync = null;

  function value(record, key) {
    const result = S.value ? S.value(record, key) : record[key];
    return result == null ? '' : result;
  }
  function text(value) {
    return value && typeof value === 'object' ? JSON.stringify(value) : String(value == null ? '' : value);
  }
  function visibleFields() { return fields.filter(field => !hiddenColumns.has(field.key)); }
  function recordId(record) { return record[primary.key]; }
  function inputId(field) { return 'mrfField_' + fields.indexOf(field); }
  function grouped(items) {
    const groups = [...new Set(items.map(field => field.group || 'requisition'))];
    groups.sort((a, b) => {
      const ai = groupOrder.indexOf(a), bi = groupOrder.indexOf(b);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    return groups.map(group => ({ key: group, label: groupNames[group] || group, fields: items.filter(field => (field.group || 'requisition') === group) }));
  }
  function setConnection(state, message) {
    $('mrfConnection').dataset.state = state;
    $('mrfConnectionText').textContent = message;
    $('mrfLastSync').textContent = lastSync ? 'Last refreshed ' + lastSync.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : '';
  }
  function fillOptions(id, field, placeholder) {
    const select = $(id);
    const selected = select.value;
    const values = field ? [...new Set(records.map(record => text(value(record, field.key))).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : [];
    select.innerHTML = `<option value="">${placeholder}</option>` + values.map(item => `<option value="${esc(item)}">${esc(item)}</option>`).join('');
    select.value = values.includes(selected) ? selected : '';
    select.disabled = !field || !loaded;
  }
  function renderColumnOptions() {
    const query = $('mrfColumnSearch').value.trim().toLowerCase();
    const matching = fields.filter(field => [field.label, field.key].join(' ').toLowerCase().includes(query));
    $('mrfColumnOptions').innerHTML = grouped(matching).map(group => `<div class="mrf-column-group">${esc(group.label)}</div>` + group.fields.map(field => `<label class="mrf-column-option"><input type="checkbox" data-column="${esc(field.key)}" ${hiddenColumns.has(field.key) ? '' : 'checked'} ${field === primary ? 'disabled' : ''}><span>${esc(field.label)}${field === primary ? ' · pinned' : ''}</span></label>`).join('')).join('') || '<p class="inline-empty">No matching columns.</p>';
    $('mrfVisibleColumns').textContent = `(${visibleFields().length}/${fields.length})`;
    $('mrfFieldCountNote').textContent = `${visibleFields().length} of ${fields.length} fields visible`;
  }
  function dateValue(record, fieldKey) {
    const result = text(value(record, fieldKey));
    return /^\d{4}-\d{2}-\d{2}/.test(result) ? result.slice(0, 10) : '';
  }
  function applyFilters(resetPage) {
    if (resetPage) page = 1;
    const query = $('mrfSearch').value.trim().toLowerCase();
    const sheet = $('mrfSheet').value;
    const status = $('mrfStatus').value;
    const site = $('mrfSite').value;
    const from = $('mrfFrom').value;
    const to = $('mrfTo').value;
    const dateKey = $('mrfDateField').value;
    const invalidRange = Boolean(from && to && from > to);
    $('mrfFilterError').hidden = !invalidRange;
    filtered = invalidRange ? [] : records.filter(record => {
      if (query && !fields.some(field => text(value(record, field.key)).toLowerCase().includes(query))) return false;
      if (sheet && (!sheetField || text(value(record, sheetField.key)) !== sheet)) return false;
      if (site && (!siteField || text(value(record, siteField.key)) !== site)) return false;
      if (status && (!statusField || text(value(record, statusField.key)) !== status)) return false;
      const date = dateKey ? dateValue(record, dateKey) : '';
      return (!from || date >= from) && (!to || date && date <= to);
    });
    const sortField = fields.find(field => field.key === sortKey);
    filtered.sort((a, b) => {
      const av = value(a, sortKey), bv = value(b, sortKey);
      if (av === '' && bv !== '') return 1;
      if (bv === '' && av !== '') return -1;
      const numeric = sortField && ['integer', 'number'].includes(sortField.type) && Number.isFinite(Number(av)) && Number.isFinite(Number(bv));
      return sortDirection * (numeric ? Number(av) - Number(bv) : text(av).localeCompare(text(bv), undefined, { numeric: true, sensitivity: 'base' }));
    });
    renderGrid();
  }
  function displayCell(record, field) {
    const result = value(record, field.key);
    if (result === '') return '<span class="mrf-cell-empty">—</span>';
    if (field.type === 'json' || result && typeof result === 'object') return `<button type="button" class="mrf-source-button" data-source-id="${esc(recordId(record))}" data-source-field="${esc(field.key)}">View source</button>`;
    let resultText = text(result);
    if (field.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(resultText)) resultText = A.formatDate(resultText);
    if (statusField === field) return `<span class="record-badge">${esc(resultText)}</span>`;
    return `<span class="mrf-cell-text" title="${esc(resultText.slice(0, 1000))}">${esc(resultText)}</span>`;
  }
  function renderGrid() {
    const columns = visibleFields();
    const pageSize = Number($('mrfPageSize').value) || 25;
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.min(Math.max(1, page), pages);
    const first = (page - 1) * pageSize;
    const pageRecords = filtered.slice(first, first + pageSize);
    $('mrfHead').innerHTML = '<tr><th scope="col" class="mrf-actions-cell">Action</th>' + columns.map(field => `<th scope="col" class="${field === primary ? 'mrf-identity-cell' : ''}" ${sortKey === field.key ? `aria-sort="${sortDirection === 1 ? 'ascending' : 'descending'}"` : 'aria-sort="none"'}><button type="button" class="mrf-sort" data-sort="${esc(field.key)}"><span>${esc(field.label)}</span><span class="mrf-sort-arrow" aria-hidden="true">${sortKey === field.key ? sortDirection === 1 ? '↑' : '↓' : '↕'}</span></button></th>`).join('') + '</tr>';
    $('mrfBody').innerHTML = pageRecords.map(record => `<tr><td class="mrf-actions-cell"><button type="button" class="btn-sm ghost" data-edit-mrf="${esc(recordId(record))}" aria-label="Edit MRF ${esc(recordId(record))}">Edit</button></td>` + columns.map(field => `<td class="${field === primary ? 'mrf-identity-cell' : ''}">${displayCell(record, field)}</td>`).join('') + '</tr>').join('') || `<tr><td class="empty-state" colspan="${columns.length + 1}">${loading ? 'Loading MRF Monitoring records…' : !loaded ? 'Connect to Supabase to load your MRF Monitoring records.' : records.length ? 'No records match your filters. Try a different search or clear filters.' : 'No MRF records found. Import the workbook or create your first record.'}</td></tr>`;
    $('mrfTotal').textContent = loaded ? records.length.toLocaleString() : '—';
    $('mrfMatching').textContent = loaded ? filtered.length.toLocaleString() : '—';
    $('mrfSheets').textContent = loaded ? new Set(sheetField ? records.map(record => text(value(record, sheetField.key))).filter(Boolean) : []).size : '—';
    $('mrfFields').textContent = fields.length;
    $('mrfCount').textContent = loaded ? filtered.length ? `Showing ${first + 1}–${first + pageRecords.length} of ${filtered.length.toLocaleString()} matching records · ${records.length.toLocaleString()} total` : `0 matching records · ${records.length.toLocaleString()} total` : loading ? 'Connecting to Supabase…' : 'Records unavailable';
    $('mrfPageLabel').textContent = `Page ${page} of ${pages}`;
    $('mrfPrevious').disabled = page <= 1;
    $('mrfNext').disabled = page >= pages;
    $('exportMrfs').disabled = !filtered.length || loading;
    $('addMrf').disabled = !loaded || loading || !S.context?.companyConfigured;
    $('addMrf').title = S.context?.companyConfigured ? 'Create an MRF record' : 'Link the administrator to a company in Supabase before creating MRF records.';
    $('mrfGrid').setAttribute('aria-busy', String(loading));
    renderColumnOptions();
  }
  async function loadRecords() {
    if (loading) return;
    loading = true;
    $('refreshMrfs').disabled = true;
    $('retryMrfs').disabled = true;
    $('mrfError').hidden = true;
    setConnection('loading', 'Connecting to Supabase…');
    renderGrid();
    try {
      const result = await S.list();
      if (!Array.isArray(result)) throw new Error('The server returned an invalid MRF response.');
      records = result;
      loaded = true;
      lastSync = new Date();
      fillOptions('mrfSheet', sheetField, 'All worksheets');
      fillOptions('mrfStatus', statusField, 'All statuses');
      fillOptions('mrfSite', siteField, 'All sites');
      setConnection('connected', 'Connected to Supabase · MRF Monitoring');
      $('mrfGridHelp').textContent = S.context?.companyConfigured
        ? 'All records are read from and saved to Supabase for AdminID ' + S.context.AdminID + '.'
        : 'Connected for AdminID ' + S.context?.AdminID + '. To create records, first add your company in Supabase ATS_Companies and link its CompanyID to this administrator.';
    } catch (error) {
      $('mrfErrorTitle').textContent = loaded ? 'Unable to refresh MRF Monitoring' : 'Unable to load MRF Monitoring';
      $('mrfErrorMessage').textContent = (error && error.message || 'Check your connection and Supabase access, then try again.') + (loaded ? ' Previously loaded results are still shown below.' : '');
      $('mrfError').hidden = false;
      setConnection('error', loaded ? 'Connection error · showing last loaded records' : 'Supabase connection requires attention');
    } finally {
      loading = false;
      $('refreshMrfs').disabled = false;
      $('retryMrfs').disabled = false;
      applyFilters(false);
    }
  }
  function inputValue(record, field) {
    const raw = value(record, field.key);
    if (raw === '') return '';
    if (field.type === 'integer' || field.type === 'number') return Number.isFinite(Number(raw)) ? text(raw) : '';
    if (field.type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(text(raw)) ? text(raw) : '';
    if (field.type === 'datetime') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text(raw)) ? text(raw).slice(0, 16) : '';
    return text(raw);
  }
  function renderForm(record) {
    formInitial = {};
    const formFields = record ? fields : editableFields;
    $('mrfFormFields').innerHTML = grouped(formFields).map(group => `<fieldset class="mrf-form-section"><legend>${esc(group.label)}</legend><div class="form-grid">` + group.fields.map(field => {
      const raw = record ? value(record, field.key) : '';
      const readonly = field.readOnly || field.primary || field.type === 'json';
      const wide = field.type === 'json' || /remarks|feedback|description|notes/i.test(field.key);
      const fieldId = inputId(field);
      let control;
      if (readonly) {
        control = `<p class="mrf-form-readonly">${field.type === 'json' && raw !== '' ? 'Preserved workbook source · use View source in the grid to inspect.' : esc(text(raw) || 'Assigned automatically')}</p>`;
      } else {
        const initial = record ? inputValue(record, field) : '';
        formInitial[field.key] = initial;
        const type = field.type === 'integer' || field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : 'text';
        const attr = `id="${esc(fieldId)}" class="field-input" name="${esc(field.key)}" data-mrf-field="${esc(field.key)}" ${field.required ? 'required' : ''}`;
        const catalogGroup = ['POSITION','Position'].includes(field.key) ? 'positions' : field.key==='Site' ? 'locations' : null;
        if (catalogGroup) {
          const choices = A.catalogs?.[catalogGroup] || [];
          control = `<select ${attr}><option value="">Select ${esc(field.label)}</option>` + choices.map(row=>`<option value="${esc(row.name)}" ${row.name===initial?'selected':''}>${esc(row.name)}${catalogGroup==='positions'?' · '+row.slots_available+' available':''}</option>`).join('') + (initial&&!choices.some(row=>row.name===initial)?`<option value="${esc(initial)}" selected>${esc(initial)} (saved value)</option>`:'') + '</select>';
        } else control = wide ? `<textarea ${attr} rows="3" maxlength="20000">${esc(initial)}</textarea>` : `<input ${attr} type="${type}" value="${esc(initial)}" ${type === 'number' ? `step="${field.type === 'integer' ? '1' : 'any'}"` : type === 'text' ? 'maxlength="1000"' : ''}>`;
        if (record && raw !== '' && initial === '') control += `<p class="mrf-form-help">Original source: ${esc(text(raw))}. Leave unchanged to preserve this value.</p>`;
      }
      return `<div class="form-field${wide ? ' mrf-wide-field' : ''}"><label class="field-label" ${readonly ? '' : `for="${esc(fieldId)}"`}>${esc(field.label)}${field.required ? ' *' : ''}${readonly ? ' · read only' : ''}</label>${control}</div>`;
    }).join('') + '</div></fieldset>').join('');
  }
  function openForm(record) {
    editingRecord = record || null;
    $('mrfFormError').hidden = true;
    $('mrfDialogTitle').textContent = record ? `Edit MRF ${recordId(record)}` : 'Create MRF record';
    $('saveMrf').textContent = record ? 'Save changes' : 'Create record';
    renderForm(record);
    A.openDialog($('mrfDialog'));
  }
  function showSource(record, key) {
    const field = fields.find(item => item.key === key);
    const raw = value(record, key);
    $('mrfSourceTitle').textContent = field ? field.label : 'Original workbook data';
    $('mrfSourceData').textContent = typeof raw === 'object' ? JSON.stringify(raw, null, 2) : text(raw);
    A.openDialog($('mrfSourceDialog'));
  }
  async function saveRecord(event) {
    event.preventDefault();
    if (saving) return;
    const changes = {};
    for (const field of editableFields) {
      const input = $(inputId(field));
      if (!input) continue;
      const raw = input.value.trim();
      if (editingRecord && raw === formInitial[field.key]) continue;
      if (!editingRecord && !raw) continue;
      if (field.required && !raw) {
        $('mrfFormError').textContent = field.label + ' is required.';
        $('mrfFormError').hidden = false;
        input.focus();
        return;
      }
      changes[field.key] = !raw ? null : field.type === 'number' || field.type === 'integer' ? Number(raw) : raw;
    }
    if (!Object.keys(changes).length) {
      if (editingRecord) { A.closeDialog($('mrfDialog')); A.notify('No changes to save.'); }
      else { $('mrfFormError').textContent = 'Enter the MRF details before creating a record.'; $('mrfFormError').hidden = false; }
      return;
    }
    saving = true;
    $('saveMrf').disabled = true;
    $('saveMrf').textContent = 'Saving to Supabase…';
    $('mrfFormError').hidden = true;
    try {
      const existingId = editingRecord ? recordId(editingRecord) : undefined;
      const saved = await S.save(changes, existingId);
      if (!saved || typeof saved !== 'object') throw new Error('The server did not confirm that this record was saved.');
      const merged = { ...(editingRecord || {}), ...saved };
      if (editingRecord) records = records.map(record => recordId(record) === existingId ? merged : record);
      else records.push(merged);
      fillOptions('mrfSheet', sheetField, 'All worksheets');
      fillOptions('mrfStatus', statusField, 'All statuses');
      applyFilters(false);
      A.closeDialog($('mrfDialog'));
      A.notify(editingRecord ? 'MRF record updated in Supabase.' : 'MRF record created in Supabase.');
      lastSync = new Date();
      setConnection('connected', 'Connected to Supabase · MRF Monitoring');
    } catch (error) {
      $('mrfFormError').textContent = error && error.message || 'The record could not be saved to Supabase. Please try again.';
      $('mrfFormError').hidden = false;
    } finally {
      saving = false;
      $('saveMrf').disabled = false;
      $('saveMrf').textContent = editingRecord ? 'Save changes' : 'Create record';
    }
  }
  function exportCsv() {
    const cell = raw => {
      let result = text(raw);
      if (/^[\s]*[=+@-]/.test(result)) result = "'" + result;
      return '"' + result.replace(/"/g, '""') + '"';
    };
    const rows = [fields.map(field => field.label), ...filtered.map(record => fields.map(field => value(record, field.key)))];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `mrf-monitoring-${A.today()}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!S || !fields.length || !primary) {
    $('mrfErrorTitle').textContent = 'MRF connection is not configured';
    $('mrfErrorMessage').textContent = 'The MRF data service could not be loaded. Refresh the page after the connection is configured.';
    $('mrfError').hidden = false;
    setConnection('error', 'MRF data service unavailable');
    return;
  }
  $('mrfDateField').innerHTML = dateFields.map(field => `<option value="${esc(field.key)}">${esc(field.label)}</option>`).join('') || '<option value="">No date fields</option>';
  const defaultDate = dateFields.find(field => field.key === 'CREATED DATE');
  if (defaultDate) $('mrfDateField').value = defaultDate.key;
  if (!dateFields.length) ['mrfDateField', 'mrfFrom', 'mrfTo'].forEach(id => { $(id).disabled = true; });
  $('mrfSheet').disabled = !sheetField;
  $('mrfStatus').disabled = !statusField;
  $('mrfSite').disabled = !siteField;
  $('refreshMrfs').addEventListener('click', loadRecords);
  $('retryMrfs').addEventListener('click', loadRecords);
  $('addMrf').addEventListener('click', () => openForm());
  document.querySelectorAll('[data-close-mrf]').forEach(button => button.addEventListener('click', () => { if (!saving) A.closeDialog($('mrfDialog')); }));
  $('mrfDialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  $('closeMrfSource').addEventListener('click', () => A.closeDialog($('mrfSourceDialog')));
  $('mrfForm').addEventListener('submit', saveRecord);
  $('mrfHead').addEventListener('click', event => {
    const button = event.target.closest('[data-sort]');
    if (!button) return;
    const key = button.dataset.sort;
    sortDirection = sortKey === key ? -sortDirection : 1;
    sortKey = key;
    applyFilters(true);
  });
  $('mrfBody').addEventListener('click', event => {
    const edit = event.target.closest('[data-edit-mrf]');
    const source = event.target.closest('[data-source-id]');
    const id = edit ? edit.dataset.editMrf : source ? source.dataset.sourceId : null;
    const record = id === null ? null : records.find(item => String(recordId(item)) === id);
    if (record && edit) openForm(record);
    if (record && source) showSource(record, source.dataset.sourceField);
  });
  $('mrfSearch').addEventListener('input', () => applyFilters(true));
  ['mrfSheet', 'mrfSite', 'mrfStatus', 'mrfDateField', 'mrfFrom', 'mrfTo'].forEach(id => $(id).addEventListener('change', () => applyFilters(true)));
  $('clearMrfFilters').addEventListener('click', () => {
    ['mrfSearch', 'mrfSheet', 'mrfSite', 'mrfStatus', 'mrfFrom', 'mrfTo'].forEach(id => { $(id).value = ''; });
    applyFilters(true);
  });
  $('mrfPageSize').addEventListener('change', () => { page = 1; renderGrid(); });
  $('mrfPrevious').addEventListener('click', () => { page--; renderGrid(); $('mrfGridScroll').scrollTop = 0; });
  $('mrfNext').addEventListener('click', () => { page++; renderGrid(); $('mrfGridScroll').scrollTop = 0; });
  $('mrfColumnSearch').addEventListener('input', renderColumnOptions);
  $('mrfColumnOptions').addEventListener('change', event => {
    if (!event.target.matches('[data-column]')) return;
    const key = event.target.dataset.column;
    if (event.target.checked) hiddenColumns.delete(key); else hiddenColumns.add(key);
    renderGrid();
  });
  $('showAllMrfColumns').addEventListener('click', () => { hiddenColumns.clear(); renderGrid(); });
  $('exportMrfs').addEventListener('click', exportCsv);
  loadRecords();
})();
