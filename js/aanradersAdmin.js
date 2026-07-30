// Aanraders-beheer — tabblad in het admin-dashboard (/admin-chat.html).
//
// Beheert de drie tabellen achter de publieke affiliatepagina /aanraders:
// producten, categorieën en gratis downloads.
//
// Auth: dezelfde community-sessie als de rest van het dashboard. De
// zichtbaarheid van dit tabblad is cosmetisch — het echte slot zit in
// api/aanraders.mjs (requireAdmin → allowed_users.is_admin).

import { sessionRefreshIfNeeded } from './supabase.js?v=3.1.5';
import { escapeHtml, processImageForUpload, showToast, confirm as confirmDialog } from './utils.js?v=3.1.5';

const API = '/api/aanraders/admin';

/* Labels voor de vier transparantie-waarden. Moet overeenkomen met
   RELATIE_LABELS in api/aanraders.mjs. */
const RELATIE_OPTIES = [
  ['affiliate_korting', 'Affiliatelink + kortingscode'],
  ['affiliate',         'Affiliatelink'],
  ['enkel_korting',     'Enkel kortingscode — geen commissie'],
  ['geen_samenwerking', 'Persoonlijke aanbeveling — geen samenwerking'],
];

const LABEL_OPTIES = ['favoriet', 'bestseller', 'community-favoriet', 'budgetvriendelijk', 'nieuw'];

let data = { categorieen: [], producten: [], downloads: [] };
let geladen = false;
let root = null;

/* ---------------------------------------------------------------
   API-helpers
--------------------------------------------------------------- */

async function call(path, { method = 'GET', body } = {}) {
  const session = await sessionRefreshIfNeeded();
  if (!session) throw new Error('Geen sessie. Log opnieuw in.');

  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + session.access_token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Fout ${res.status}`);
  return json;
}

/* ---------------------------------------------------------------
   Helpers
--------------------------------------------------------------- */

function categorieNaam(id) {
  const c = data.categorieen.find(c => c.id === id);
  return c ? c.titel : '—';
}

function relatieLabel(v) {
  const gevonden = RELATIE_OPTIES.find(o => o[0] === v);
  return gevonden ? gevonden[1] : v || '—';
}

/** Textarea met één item per regel → array. Lege regels vallen weg. */
function regelsNaarArray(v) {
  return String(v || '').split('\n').map(r => r.trim()).filter(Boolean);
}

function arrayNaarRegels(v) {
  return Array.isArray(v) ? v.join('\n') : '';
}

/** FAQ als "vraag | antwoord" per regel — simpeler dan een aparte editor. */
function regelsNaarFaq(v) {
  return regelsNaarArray(v).map(r => {
    const i = r.indexOf('|');
    if (i === -1) return { vraag: r, antwoord: '' };
    return { vraag: r.slice(0, i).trim(), antwoord: r.slice(i + 1).trim() };
  }).filter(f => f.vraag && f.antwoord);
}

function faqNaarRegels(v) {
  return Array.isArray(v) ? v.map(f => `${f.vraag} | ${f.antwoord}`).join('\n') : '';
}

function val(id) {
  const el = root.querySelector('#' + id);
  return el ? el.value : '';
}

function checked(id) {
  const el = root.querySelector('#' + id);
  return el ? el.checked : false;
}

/* ---------------------------------------------------------------
   Laden
--------------------------------------------------------------- */

export async function laadAanraders() {
  const mount = document.getElementById('aanraders-mount');
  if (!mount) return;
  root = mount;

  mount.innerHTML = '<div class="loading">Laden…</div>';
  try {
    data = await call('/data');
    geladen = true;
    renderOverzicht();
  } catch (err) {
    mount.innerHTML = `<div class="error-box">Kon de aanraders niet laden: ${escapeHtml(err.message)}</div>`;
  }
}

/* ---------------------------------------------------------------
   Overzicht
--------------------------------------------------------------- */

function renderOverzicht() {
  const producten = [...data.producten].sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0));

  const rijen = producten.map(p => `
    <tr>
      <td>
        <strong>${escapeHtml(p.titel)}</strong>
        <div class="muted" style="font-size:.78rem">${escapeHtml(p.merk || '')} · /${escapeHtml(p.slug)}</div>
      </td>
      <td>${escapeHtml(categorieNaam(p.categorie_id))}</td>
      <td style="font-size:.8rem">${escapeHtml(relatieLabel(p.relatie_type))}</td>
      <td>${p.favoriet_anneleen ? '⭐' : ''}</td>
      <td>
        <span class="aa-badge ${p.zichtbaar ? 'aa-badge--aan' : 'aa-badge--uit'}">
          ${p.zichtbaar ? 'zichtbaar' : 'verborgen'}
        </span>
      </td>
      <td style="white-space:nowrap">
        <button type="button" class="aa-btn" data-actie="bewerk" data-id="${p.id}">Bewerken</button>
        <button type="button" class="aa-btn aa-btn--stil" data-actie="toggle" data-id="${p.id}">
          ${p.zichtbaar ? 'Verbergen' : 'Tonen'}
        </button>
        <button type="button" class="aa-btn aa-btn--rood" data-actie="verwijder" data-id="${p.id}">Verwijderen</button>
      </td>
    </tr>`).join('');

  const catRijen = data.categorieen.map(c => `
    <tr>
      <td>${escapeHtml(c.emoji || '')} <strong>${escapeHtml(c.titel)}</strong>
        <div class="muted" style="font-size:.78rem">/${escapeHtml(c.slug)}</div>
      </td>
      <td style="width:90px">
        <input type="number" class="aa-input aa-cat-volgorde" data-id="${c.id}" value="${c.volgorde ?? 0}">
      </td>
      <td><label class="aa-check"><input type="checkbox" class="aa-cat-binnenkort" data-id="${c.id}" ${c.binnenkort ? 'checked' : ''}> binnenkort</label></td>
      <td><label class="aa-check"><input type="checkbox" class="aa-cat-zichtbaar" data-id="${c.id}" ${c.zichtbaar ? 'checked' : ''}> zichtbaar</label></td>
      <td><button type="button" class="aa-btn" data-actie="cat-opslaan" data-id="${c.id}">Opslaan</button></td>
    </tr>`).join('');

  const dlRijen = data.downloads.length ? data.downloads.map(d => `
    <tr>
      <td>${escapeHtml(d.emoji || '📄')} <strong>${escapeHtml(d.titel)}</strong>
        <div class="muted" style="font-size:.78rem">${escapeHtml(d.omschrijving || '')}</div>
      </td>
      <td>
        <span class="aa-badge ${d.zichtbaar ? 'aa-badge--aan' : 'aa-badge--uit'}">
          ${d.zichtbaar ? 'zichtbaar' : 'verborgen'}
        </span>
      </td>
      <td style="white-space:nowrap">
        <button type="button" class="aa-btn" data-actie="dl-bewerk" data-id="${d.id}">Bewerken</button>
        <button type="button" class="aa-btn aa-btn--rood" data-actie="dl-verwijder" data-id="${d.id}">Verwijderen</button>
      </td>
    </tr>`).join('')
    : '<tr><td colspan="3" class="muted">Nog geen downloads toegevoegd.</td></tr>';

  root.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h3>Producten (${producten.length})</h3>
        <button type="button" class="aa-btn aa-btn--primair" data-actie="nieuw" style="margin-left:auto">+ Nieuw product</button>
      </div>
      <div class="panel-body">
        <p class="muted" style="margin-bottom:.75rem;font-size:.85rem">
          Alleen producten op <strong>zichtbaar</strong> staan op
          <a href="/aanraders" target="_blank" rel="noopener">de publieke pagina</a>.
        </p>
        <div class="aa-tabel-wrap">
          <table class="aa-tabel">
            <thead><tr><th>Product</th><th>Categorie</th><th>Relatie</th><th>Fav</th><th>Status</th><th></th></tr></thead>
            <tbody>${rijen || '<tr><td colspan="6" class="muted">Nog geen producten.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:1.25rem">
      <div class="panel-header"><h3>Categorieën</h3></div>
      <div class="panel-body">
        <p class="muted" style="margin-bottom:.75rem;font-size:.85rem">
          "Binnenkort" toont een placeholder in plaats van producten. Een categorie zonder
          zichtbare producten toont dat blok sowieso.
        </p>
        <div class="aa-tabel-wrap">
          <table class="aa-tabel">
            <thead><tr><th>Categorie</th><th>Volgorde</th><th></th><th></th><th></th></tr></thead>
            <tbody>${catRijen}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:1.25rem">
      <div class="panel-header">
        <h3>Gratis downloads</h3>
        <button type="button" class="aa-btn aa-btn--primair" data-actie="dl-nieuw" style="margin-left:auto">+ Nieuwe download</button>
      </div>
      <div class="panel-body">
        <div class="aa-tabel-wrap">
          <table class="aa-tabel">
            <thead><tr><th>Download</th><th>Status</th><th></th></tr></thead>
            <tbody>${dlRijen}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

/* ---------------------------------------------------------------
   Productformulier
--------------------------------------------------------------- */

function renderProductForm(p) {
  const nieuw = !p;
  const v = p || {};

  const catOpties = data.categorieen.map(c =>
    `<option value="${c.id}" ${v.categorie_id === c.id ? 'selected' : ''}>${escapeHtml(c.titel)}</option>`
  ).join('');

  const relOpties = RELATIE_OPTIES.map(([w, l]) =>
    `<option value="${w}" ${v.relatie_type === w ? 'selected' : ''}>${escapeHtml(l)}</option>`
  ).join('');

  const labelVinkjes = LABEL_OPTIES.map(l => `
    <label class="aa-check">
      <input type="checkbox" class="aa-label-optie" value="${l}"
        ${(v.labels || []).includes(l) ? 'checked' : ''}> ${l}
    </label>`).join('');

  root.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h3>${nieuw ? 'Nieuw product' : escapeHtml(v.titel)}</h3>
        <button type="button" class="aa-btn aa-btn--stil" data-actie="annuleer" style="margin-left:auto">← Terug</button>
      </div>
      <div class="panel-body">
        <input type="hidden" id="aa-id" value="${v.id || ''}">

        <div class="aa-sectie">Basis</div>
        <div class="aa-rij">
          <label class="aa-veld"><span>Titel *</span>
            <input class="aa-input" id="aa-titel" value="${escapeHtml(v.titel || '')}"></label>
          <label class="aa-veld"><span>Merk</span>
            <input class="aa-input" id="aa-merk" value="${escapeHtml(v.merk || '')}"></label>
        </div>
        <div class="aa-rij">
          <label class="aa-veld"><span>Slug (URL)</span>
            <input class="aa-input" id="aa-slug" value="${escapeHtml(v.slug || '')}" placeholder="wordt afgeleid uit de titel">
            <small class="muted">/aanraders/p/<span id="aa-slug-preview">${escapeHtml(v.slug || '…')}</span></small></label>
          <label class="aa-veld"><span>Categorie</span>
            <select class="aa-input" id="aa-categorie"><option value="">— geen —</option>${catOpties}</select></label>
        </div>
        <label class="aa-veld"><span>Korte beschrijving (op de kaart)</span>
          <textarea class="aa-input" id="aa-kort" rows="2">${escapeHtml(v.korte_beschrijving || '')}</textarea></label>
        <label class="aa-veld"><span>Waarom ik dit aanbeveel</span>
          <textarea class="aa-input" id="aa-waarom" rows="3">${escapeHtml(v.waarom_aanbevolen || '')}</textarea></label>
        <label class="aa-veld"><span>Lange beschrijving (detailpagina — lege regel = nieuwe alinea)</span>
          <textarea class="aa-input" id="aa-lang" rows="6">${escapeHtml(v.lange_beschrijving || '')}</textarea></label>

        <div class="aa-sectie">Foto's</div>
        <div class="aa-foto-blok">
          <div class="aa-foto-preview" id="aa-foto-preview">
            ${v.afbeelding_url ? `<img src="${escapeHtml(v.afbeelding_url)}" alt="">` : '<span class="muted">geen foto</span>'}
          </div>
          <div>
            <input type="file" id="aa-foto-file" accept="image/*" style="display:none">
            <button type="button" class="aa-btn" data-actie="kies-foto">Hoofdfoto kiezen</button>
            <div class="muted" style="font-size:.78rem;margin-top:.4rem">
              Locatiegegevens worden automatisch verwijderd; de foto wordt verkleind naar max 1920px.
            </div>
            <input type="hidden" id="aa-afbeelding-url" value="${escapeHtml(v.afbeelding_url || '')}">
          </div>
        </div>
        <label class="aa-veld"><span>Extra foto's (één URL per regel)</span>
          <textarea class="aa-input" id="aa-afbeeldingen" rows="3">${escapeHtml(arrayNaarRegels(v.afbeeldingen))}</textarea></label>

        <div class="aa-sectie">Samenwerking</div>
        <div class="aa-rij">
          <label class="aa-veld"><span>Relatietype *</span>
            <select class="aa-input" id="aa-relatie">${relOpties}</select>
            <small class="muted">Staat zichtbaar op de kaart én de detailpagina.</small></label>
          <label class="aa-veld aa-veld--check">
            <label class="aa-check"><input type="checkbox" id="aa-commissie" ${v.commissie ? 'checked' : ''}> Pril Leven ontvangt commissie</label>
          </label>
        </div>
        <label class="aa-veld"><span>Affiliate-link</span>
          <input class="aa-input" id="aa-link" value="${escapeHtml(v.affiliate_link || '')}" placeholder="https://…"></label>
        <div class="aa-rij">
          <label class="aa-veld"><span>Kortingscode</span>
            <input class="aa-input" id="aa-code" value="${escapeHtml(v.kortingscode || '')}"></label>
          <label class="aa-veld"><span>Kortingstekst</span>
            <input class="aa-input" id="aa-kortingtekst" value="${escapeHtml(v.korting_tekst || '')}" placeholder="15% korting"></label>
        </div>

        <div class="aa-sectie">Filters &amp; weergave</div>
        <div class="aa-rij">
          <label class="aa-veld"><span>Leeftijd vanaf (maanden)</span>
            <input class="aa-input" type="number" id="aa-leeftijd" value="${v.leeftijd_vanaf_maanden ?? ''}" placeholder="leeg = alle leeftijden"></label>
          <label class="aa-veld"><span>Prijsindicatie</span>
            <select class="aa-input" id="aa-prijsind">
              <option value="">—</option>
              ${['€', '€€', '€€€'].map(x => `<option value="${x}" ${v.prijs_indicatie === x ? 'selected' : ''}>${x}</option>`).join('')}
            </select></label>
        </div>
        <div class="aa-rij">
          <label class="aa-veld"><span>Materiaal</span>
            <input class="aa-input" id="aa-materiaal" value="${escapeHtml(v.materiaal || '')}"></label>
          <label class="aa-veld"><span>Volgorde</span>
            <input class="aa-input" type="number" id="aa-volgorde" value="${v.volgorde ?? 0}"></label>
        </div>
        <div class="aa-veld"><span>Labels</span><div class="aa-checks">${labelVinkjes}</div></div>

        <div class="aa-sectie">Detailpagina</div>
        <label class="aa-veld"><span>Voordelen (één per regel)</span>
          <textarea class="aa-input" id="aa-voordelen" rows="4">${escapeHtml(arrayNaarRegels(v.voordelen))}</textarea></label>
        <label class="aa-veld"><span>Nadelen (één per regel)</span>
          <textarea class="aa-input" id="aa-nadelen" rows="4">${escapeHtml(arrayNaarRegels(v.nadelen))}</textarea></label>
        <label class="aa-veld"><span>FAQ — één per regel, als <code>vraag | antwoord</code></span>
          <textarea class="aa-input" id="aa-faq" rows="4">${escapeHtml(faqNaarRegels(v.faq))}</textarea></label>
        <label class="aa-veld"><span>Waarschuwing / opmerking</span>
          <textarea class="aa-input" id="aa-opmerking" rows="2">${escapeHtml(v.opmerking || '')}</textarea>
          <small class="muted">Verschijnt als geel kader. Bv. bij plantaardige melk vóór 12 maanden.</small></label>

        <div class="aa-sectie">Status</div>
        <div class="aa-checks">
          <label class="aa-check"><input type="checkbox" id="aa-getest" ${v.persoonlijk_getest ? 'checked' : ''}> Persoonlijk getest</label>
          <label class="aa-check"><input type="checkbox" id="aa-gebruik" ${v.zelf_in_gebruik ? 'checked' : ''}> Zelf in gebruik</label>
          <label class="aa-check"><input type="checkbox" id="aa-commfav" ${v.community_favoriet ? 'checked' : ''}> Community favoriet</label>
          <label class="aa-check"><input type="checkbox" id="aa-fav" ${v.favoriet_anneleen ? 'checked' : ''}> Favoriet van Anneleen</label>
          <label class="aa-check"><input type="checkbox" id="aa-zichtbaar" ${v.zichtbaar ? 'checked' : ''}> <strong>Zichtbaar op de site</strong></label>
        </div>
        <div class="aa-rij">
          <label class="aa-veld"><span>Volgorde bij favorieten</span>
            <input class="aa-input" type="number" id="aa-favvolgorde" value="${v.favoriet_volgorde ?? ''}"></label>
          <label class="aa-veld"><span>Laatst gecontroleerd</span>
            <input class="aa-input" type="date" id="aa-gecontroleerd" value="${escapeHtml(v.laatst_gecontroleerd || '')}"></label>
        </div>

        <div class="aa-acties">
          <button type="button" class="aa-btn aa-btn--primair" data-actie="opslaan">Opslaan</button>
          <button type="button" class="aa-btn aa-btn--stil" data-actie="annuleer">Annuleren</button>
          <span id="aa-status" class="muted"></span>
        </div>
      </div>
    </div>`;

  const titelEl = root.querySelector('#aa-titel');
  const slugEl = root.querySelector('#aa-slug');
  const preview = root.querySelector('#aa-slug-preview');
  const updatePreview = () => {
    preview.textContent = slugEl.value.trim() || slugify(titelEl.value) || '…';
  };
  titelEl.addEventListener('input', updatePreview);
  slugEl.addEventListener('input', updatePreview);
}

function slugify(v) {
  return String(v).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function verzamelProduct() {
  return {
    titel: val('aa-titel').trim(),
    slug: val('aa-slug').trim(),
    merk: val('aa-merk').trim(),
    categorie_id: val('aa-categorie') || null,
    korte_beschrijving: val('aa-kort').trim(),
    waarom_aanbevolen: val('aa-waarom').trim(),
    lange_beschrijving: val('aa-lang').trim(),
    afbeelding_url: val('aa-afbeelding-url').trim(),
    afbeeldingen: regelsNaarArray(val('aa-afbeeldingen')),
    relatie_type: val('aa-relatie'),
    commissie: checked('aa-commissie'),
    affiliate_link: val('aa-link').trim(),
    kortingscode: val('aa-code').trim(),
    korting_tekst: val('aa-kortingtekst').trim(),
    leeftijd_vanaf_maanden: val('aa-leeftijd') === '' ? null : val('aa-leeftijd'),
    prijs_indicatie: val('aa-prijsind') || null,
    materiaal: val('aa-materiaal').trim(),
    volgorde: val('aa-volgorde') || 0,
    labels: [...root.querySelectorAll('.aa-label-optie:checked')].map(el => el.value),
    voordelen: regelsNaarArray(val('aa-voordelen')),
    nadelen: regelsNaarArray(val('aa-nadelen')),
    faq: regelsNaarFaq(val('aa-faq')),
    opmerking: val('aa-opmerking').trim(),
    persoonlijk_getest: checked('aa-getest'),
    zelf_in_gebruik: checked('aa-gebruik'),
    community_favoriet: checked('aa-commfav'),
    favoriet_anneleen: checked('aa-fav'),
    zichtbaar: checked('aa-zichtbaar'),
    favoriet_volgorde: val('aa-favvolgorde') === '' ? null : val('aa-favvolgorde'),
    laatst_gecontroleerd: val('aa-gecontroleerd') || null,
  };
}

/* ---------------------------------------------------------------
   Downloadformulier
--------------------------------------------------------------- */

function renderDownloadForm(d) {
  const v = d || {};
  root.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h3>${d ? escapeHtml(v.titel) : 'Nieuwe download'}</h3>
        <button type="button" class="aa-btn aa-btn--stil" data-actie="annuleer" style="margin-left:auto">← Terug</button>
      </div>
      <div class="panel-body">
        <input type="hidden" id="aa-dl-id" value="${v.id || ''}">
        <div class="aa-rij">
          <label class="aa-veld"><span>Titel *</span>
            <input class="aa-input" id="aa-dl-titel" value="${escapeHtml(v.titel || '')}"></label>
          <label class="aa-veld"><span>Emoji</span>
            <input class="aa-input" id="aa-dl-emoji" value="${escapeHtml(v.emoji || '')}" placeholder="📋"></label>
        </div>
        <label class="aa-veld"><span>Omschrijving</span>
          <input class="aa-input" id="aa-dl-oms" value="${escapeHtml(v.omschrijving || '')}"></label>
        <label class="aa-veld"><span>Bestand-URL</span>
          <input class="aa-input" id="aa-dl-url" value="${escapeHtml(v.bestand_url || '')}" placeholder="https://…"></label>
        <div class="aa-rij">
          <label class="aa-veld"><span>Volgorde</span>
            <input class="aa-input" type="number" id="aa-dl-volgorde" value="${v.volgorde ?? 0}"></label>
          <label class="aa-veld aa-veld--check">
            <label class="aa-check"><input type="checkbox" id="aa-dl-zichtbaar" ${v.zichtbaar ? 'checked' : ''}> <strong>Zichtbaar op de site</strong></label>
          </label>
        </div>
        <div class="aa-acties">
          <button type="button" class="aa-btn aa-btn--primair" data-actie="dl-opslaan">Opslaan</button>
          <button type="button" class="aa-btn aa-btn--stil" data-actie="annuleer">Annuleren</button>
          <span id="aa-status" class="muted"></span>
        </div>
      </div>
    </div>`;
}

/* ---------------------------------------------------------------
   Foto-upload
--------------------------------------------------------------- */

async function uploadFoto(file) {
  const statusEl = root.querySelector('#aa-status');
  const zet = t => { if (statusEl) statusEl.textContent = t; };

  zet('Foto voorbereiden…');
  /* processImageForUpload geeft { blob, width, height } terug — niet de blob zelf. */
  const { blob } = await processImageForUpload(file);

  zet('Uploaden…');
  const { uploadUrl, publicUrl } = await call('/upload-url', { method: 'POST' });

  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'image/jpeg' },
    body: blob,
  });
  if (!res.ok) throw new Error(`Upload mislukt (${res.status})`);

  root.querySelector('#aa-afbeelding-url').value = publicUrl;
  root.querySelector('#aa-foto-preview').innerHTML =
    `<img src="${escapeHtml(publicUrl)}" alt="">`;
  zet('Foto geüpload. Vergeet niet op te slaan.');
}

/* ---------------------------------------------------------------
   Acties
--------------------------------------------------------------- */

async function bewaarProduct() {
  const id = val('aa-id');
  const payload = verzamelProduct();
  const statusEl = root.querySelector('#aa-status');

  if (!payload.titel) { showToast('Titel is verplicht.', 'error'); return; }

  statusEl.textContent = 'Opslaan…';
  try {
    if (id) await call('/products/' + id, { method: 'PUT', body: payload });
    else await call('/products', { method: 'POST', body: payload });
    showToast('Product opgeslagen.', 'success');
    await laadAanraders();
  } catch (err) {
    statusEl.textContent = '';
    showToast(err.message, 'error');
  }
}

async function bewaarDownload() {
  const id = val('aa-dl-id');
  const payload = {
    titel: val('aa-dl-titel').trim(),
    emoji: val('aa-dl-emoji').trim(),
    omschrijving: val('aa-dl-oms').trim(),
    bestand_url: val('aa-dl-url').trim(),
    volgorde: val('aa-dl-volgorde') || 0,
    zichtbaar: checked('aa-dl-zichtbaar'),
  };
  if (!payload.titel) { showToast('Titel is verplicht.', 'error'); return; }

  try {
    if (id) await call('/downloads/' + id, { method: 'PUT', body: payload });
    else await call('/downloads', { method: 'POST', body: payload });
    showToast('Download opgeslagen.', 'success');
    await laadAanraders();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function bewaarCategorie(id) {
  const volgorde = root.querySelector(`.aa-cat-volgorde[data-id="${id}"]`).value;
  const binnenkort = root.querySelector(`.aa-cat-binnenkort[data-id="${id}"]`).checked;
  const zichtbaar = root.querySelector(`.aa-cat-zichtbaar[data-id="${id}"]`).checked;
  try {
    await call('/categories/' + id, { method: 'PUT', body: { volgorde, binnenkort, zichtbaar } });
    showToast('Categorie opgeslagen.', 'success');
    await laadAanraders();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ---------------------------------------------------------------
   Event delegation
--------------------------------------------------------------- */

function initEvents() {
  const mount = document.getElementById('aanraders-mount');
  if (!mount) return;

  mount.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-actie]');
    if (!btn) return;
    const actie = btn.dataset.actie;
    const id = btn.dataset.id;

    if (actie === 'nieuw')     return renderProductForm(null);
    if (actie === 'annuleer')  return renderOverzicht();
    if (actie === 'opslaan')   return bewaarProduct();
    if (actie === 'dl-nieuw')  return renderDownloadForm(null);
    if (actie === 'dl-opslaan') return bewaarDownload();

    if (actie === 'bewerk') {
      const p = data.producten.find(x => x.id === id);
      if (p) renderProductForm(p);
      return;
    }

    if (actie === 'dl-bewerk') {
      const d = data.downloads.find(x => x.id === id);
      if (d) renderDownloadForm(d);
      return;
    }

    if (actie === 'cat-opslaan') return bewaarCategorie(id);

    if (actie === 'toggle') {
      const p = data.producten.find(x => x.id === id);
      if (!p) return;
      try {
        await call('/products/' + id, { method: 'PUT', body: { zichtbaar: !p.zichtbaar } });
        await laadAanraders();
      } catch (err) { showToast(err.message, 'error'); }
      return;
    }

    if (actie === 'verwijder' || actie === 'dl-verwijder') {
      const lijst = actie === 'verwijder' ? data.producten : data.downloads;
      const item = lijst.find(x => x.id === id);
      if (!item) return;
      const ok = await confirmDialog(
        `"${item.titel}" definitief verwijderen? Dit kan niet ongedaan gemaakt worden.`
      );
      if (!ok) return;
      try {
        await call((actie === 'verwijder' ? '/products/' : '/downloads/') + id, { method: 'DELETE' });
        showToast('Verwijderd.', 'success');
        await laadAanraders();
      } catch (err) { showToast(err.message, 'error'); }
      return;
    }

    if (actie === 'kies-foto') {
      root.querySelector('#aa-foto-file').click();
      return;
    }
  });

  mount.addEventListener('change', async (e) => {
    if (e.target.id !== 'aa-foto-file') return;
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      await uploadFoto(file);
    } catch (err) {
      showToast(err.message, 'error');
      const statusEl = root.querySelector('#aa-status');
      if (statusEl) statusEl.textContent = '';
    }
    e.target.value = '';
  });
}

/** Lazy: pas laden wanneer het tabblad voor het eerst geopend wordt. */
export function initAanradersTab() {
  initEvents();
  const tab = document.querySelector('.admin-tab[data-tab="aanraders"]');
  if (!tab) return;
  tab.addEventListener('click', () => {
    if (!geladen) laadAanraders();
  });
}
