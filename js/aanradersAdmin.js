// Aanraders — beheerlaag.
//
// Wordt gebruikt vanuit js/components/aanraders.js: de admin bewerkt de
// producten op de pagina zelf, tussen de tegels, in plaats van in een
// apart dashboard. Dit is bewust géén tweede weergave — het is een laag
// bovenop dezelfde server-gerenderde HTML.
//
// Auth: de bestaande community-sessie. De zichtbaarheid van de knoppen is
// cosmetisch; het echte slot zit in api/aanraders.mjs (requireAdmin →
// allowed_users.is_admin).

import { sessionRefreshIfNeeded } from './supabase.js?v=2.5.10';
import { escapeHtml, processImageForUpload, showToast, confirm as confirmDialog } from './utils.js?v=2.5.10';

const API = '/api/aanraders/admin';

/* Moet overeenkomen met RELATIE_LABELS in api/aanraders.mjs. */
const RELATIE_OPTIES = [
  ['affiliate_korting', 'Affiliatelink + kortingscode'],
  ['affiliate',         'Affiliatelink'],
  ['enkel_korting',     'Enkel kortingscode — geen commissie'],
  ['geen_samenwerking', 'Persoonlijke aanbeveling — geen samenwerking'],
];

const LABEL_OPTIES = ['favoriet', 'bestseller', 'community-favoriet', 'budgetvriendelijk', 'nieuw'];

/* Beheerdata (inclusief onzichtbare items). Los van wat de pagina toont. */
let beheer = { categorieen: [], producten: [], downloads: [] };

/* ---------------------------------------------------------------
   API
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

export async function laadBeheerdata() {
  beheer = await call('/data');
  return beheer;
}

export function getBeheerdata() {
  return beheer;
}

export function productBySlug(slug) {
  return beheer.producten.find(p => p.slug === slug) || null;
}

/* ---------------------------------------------------------------
   Helpers
--------------------------------------------------------------- */

function regelsNaarArray(v) {
  return String(v || '').split('\n').map(r => r.trim()).filter(Boolean);
}
function arrayNaarRegels(v) {
  return Array.isArray(v) ? v.join('\n') : '';
}
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
function slugify(v) {
  return String(v).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function val(scope, id) {
  const el = scope.querySelector('#' + id);
  return el ? el.value : '';
}
function checked(scope, id) {
  const el = scope.querySelector('#' + id);
  return el ? el.checked : false;
}

/* ---------------------------------------------------------------
   Productformulier — als overlay boven de pagina
--------------------------------------------------------------- */

export function openProductEditor(product, { onKlaar }) {
  const nieuw = !product;
  const v = product || {};

  const catOpties = beheer.categorieen.map(c =>
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

  const overlay = document.createElement('div');
  overlay.className = 'aa-overlay';
  overlay.innerHTML = `
    <div class="aa-editor" role="dialog" aria-modal="true" aria-label="${nieuw ? 'Nieuw product' : 'Product bewerken'}">
      <div class="aa-editor-kop">
        <h2>${nieuw ? 'Nieuw product' : escapeHtml(v.titel || '')}</h2>
        <button type="button" class="aa-sluit" data-actie="sluit" aria-label="Sluiten">×</button>
      </div>
      <div class="aa-editor-body">
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
        <label class="aa-veld"><span>Korte beschrijving (op de tegel)</span>
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
              Locatiegegevens worden verwijderd; de foto wordt verkleind naar max 1920px.
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
            <small class="muted">Staat zichtbaar op de tegel én de detailpagina.</small></label>
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
          <small class="muted">Verschijnt als geel kader op de tegel en de detailpagina.</small></label>

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
      </div>
      <div class="aa-editor-voet">
        <button type="button" class="aa-btn aa-btn--primair" data-actie="opslaan">Opslaan</button>
        <button type="button" class="aa-btn aa-btn--stil" data-actie="sluit">Annuleren</button>
        ${nieuw ? '' : '<button type="button" class="aa-btn aa-btn--rood" data-actie="verwijder" style="margin-left:auto">Verwijderen</button>'}
        <span id="aa-status" class="muted"></span>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.body.classList.add('aa-overlay-open');

  const sluit = () => {
    overlay.remove();
    document.body.classList.remove('aa-overlay-open');
  };

  /* Slug-preview live meelopen met de titel. */
  const titelEl = overlay.querySelector('#aa-titel');
  const slugEl = overlay.querySelector('#aa-slug');
  const preview = overlay.querySelector('#aa-slug-preview');
  const updatePreview = () => {
    preview.textContent = slugEl.value.trim() || slugify(titelEl.value) || '…';
  };
  titelEl.addEventListener('input', updatePreview);
  slugEl.addEventListener('input', updatePreview);

  overlay.addEventListener('click', async (e) => {
    if (e.target === overlay) return;               // klik naast = niets (voorkomt verlies)
    const btn = e.target.closest('[data-actie]');
    if (!btn) return;

    if (btn.dataset.actie === 'sluit') return sluit();

    if (btn.dataset.actie === 'kies-foto') {
      overlay.querySelector('#aa-foto-file').click();
      return;
    }

    if (btn.dataset.actie === 'opslaan') {
      const payload = verzamel(overlay);
      if (!payload.titel) { showToast('Titel is verplicht.', 'error'); return; }
      const statusEl = overlay.querySelector('#aa-status');
      statusEl.textContent = 'Opslaan…';
      try {
        const id = val(overlay, 'aa-id');
        if (id) await call('/products/' + id, { method: 'PUT', body: payload });
        else await call('/products', { method: 'POST', body: payload });
        showToast('Opgeslagen.', 'success');
        sluit();
        await onKlaar();
      } catch (err) {
        statusEl.textContent = '';
        showToast(err.message, 'error');
      }
      return;
    }

    if (btn.dataset.actie === 'verwijder') {
      const id = val(overlay, 'aa-id');
      const ok = await confirmDialog(
        `"${v.titel}" definitief verwijderen? Dit kan niet ongedaan gemaakt worden.`
      );
      if (!ok) return;
      try {
        await call('/products/' + id, { method: 'DELETE' });
        showToast('Verwijderd.', 'success');
        sluit();
        await onKlaar();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  });

  overlay.addEventListener('change', async (e) => {
    if (e.target.id !== 'aa-foto-file') return;
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const statusEl = overlay.querySelector('#aa-status');
    try {
      statusEl.textContent = 'Foto voorbereiden…';
      /* processImageForUpload geeft { blob, width, height } terug, niet de blob zelf. */
      const { blob } = await processImageForUpload(file);
      statusEl.textContent = 'Uploaden…';
      const { uploadUrl, publicUrl } = await call('/upload-url', { method: 'POST' });
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': blob.type || 'image/jpeg' },
        body: blob,
      });
      if (!res.ok) throw new Error(`Upload mislukt (${res.status})`);
      overlay.querySelector('#aa-afbeelding-url').value = publicUrl;
      overlay.querySelector('#aa-foto-preview').innerHTML =
        `<img src="${escapeHtml(publicUrl)}" alt="">`;
      statusEl.textContent = 'Foto geüpload — vergeet niet op te slaan.';
    } catch (err) {
      statusEl.textContent = '';
      showToast(err.message, 'error');
    }
    e.target.value = '';
  });

  /* Escape sluit de editor. */
  const opEsc = (e) => {
    if (e.key === 'Escape') { sluit(); document.removeEventListener('keydown', opEsc); }
  };
  document.addEventListener('keydown', opEsc);
}

function verzamel(scope) {
  return {
    titel: val(scope, 'aa-titel').trim(),
    slug: val(scope, 'aa-slug').trim(),
    merk: val(scope, 'aa-merk').trim(),
    categorie_id: val(scope, 'aa-categorie') || null,
    korte_beschrijving: val(scope, 'aa-kort').trim(),
    waarom_aanbevolen: val(scope, 'aa-waarom').trim(),
    lange_beschrijving: val(scope, 'aa-lang').trim(),
    afbeelding_url: val(scope, 'aa-afbeelding-url').trim(),
    afbeeldingen: regelsNaarArray(val(scope, 'aa-afbeeldingen')),
    relatie_type: val(scope, 'aa-relatie'),
    commissie: checked(scope, 'aa-commissie'),
    affiliate_link: val(scope, 'aa-link').trim(),
    kortingscode: val(scope, 'aa-code').trim(),
    korting_tekst: val(scope, 'aa-kortingtekst').trim(),
    leeftijd_vanaf_maanden: val(scope, 'aa-leeftijd') === '' ? null : val(scope, 'aa-leeftijd'),
    prijs_indicatie: val(scope, 'aa-prijsind') || null,
    materiaal: val(scope, 'aa-materiaal').trim(),
    volgorde: val(scope, 'aa-volgorde') || 0,
    labels: [...scope.querySelectorAll('.aa-label-optie:checked')].map(el => el.value),
    voordelen: regelsNaarArray(val(scope, 'aa-voordelen')),
    nadelen: regelsNaarArray(val(scope, 'aa-nadelen')),
    faq: regelsNaarFaq(val(scope, 'aa-faq')),
    opmerking: val(scope, 'aa-opmerking').trim(),
    persoonlijk_getest: checked(scope, 'aa-getest'),
    zelf_in_gebruik: checked(scope, 'aa-gebruik'),
    community_favoriet: checked(scope, 'aa-commfav'),
    favoriet_anneleen: checked(scope, 'aa-fav'),
    zichtbaar: checked(scope, 'aa-zichtbaar'),
    favoriet_volgorde: val(scope, 'aa-favvolgorde') === '' ? null : val(scope, 'aa-favvolgorde'),
    laatst_gecontroleerd: val(scope, 'aa-gecontroleerd') || null,
  };
}

/* ---------------------------------------------------------------
   Snelle acties vanaf een tegel
--------------------------------------------------------------- */

export async function zetZichtbaar(id, zichtbaar) {
  await call('/products/' + id, { method: 'PUT', body: { zichtbaar } });
}

/* ---------------------------------------------------------------
   Categorieën & downloads
--------------------------------------------------------------- */

export function openBeheerEditor({ onKlaar }) {
  /* Op volgorde tonen, zodat de lijst hier dezelfde volgorde heeft als de
     pagina. Anders is het cijfer helemaal niet te plaatsen. */
  const opVolgorde = [...beheer.categorieen].sort((a, b) => (a.volgorde ?? 0) - (b.volgorde ?? 0));

  const catRijen = opVolgorde.map((c, i) => `
    <tr>
      <td style="width:34px" class="muted">${i + 1}.</td>
      <td>${escapeHtml(c.emoji || '')} <strong>${escapeHtml(c.titel)}</strong>
        <div class="muted" style="font-size:.78rem">/${escapeHtml(c.slug)}</div></td>
      <td style="width:110px">
        <input type="number" class="aa-input aa-cat-volgorde" data-id="${c.id}" value="${c.volgorde ?? 0}">
      </td>
      <td><label class="aa-check"><input type="checkbox" class="aa-cat-binnenkort" data-id="${c.id}" ${c.binnenkort ? 'checked' : ''}> binnenkort</label></td>
      <td><label class="aa-check"><input type="checkbox" class="aa-cat-zichtbaar" data-id="${c.id}" ${c.zichtbaar ? 'checked' : ''}> zichtbaar</label></td>
      <td><button type="button" class="aa-btn" data-actie="cat-opslaan" data-id="${c.id}">Opslaan</button></td>
    </tr>`).join('');

  const dlRijen = beheer.downloads.length ? beheer.downloads.map(d => `
    <tr>
      <td>${escapeHtml(d.emoji || '📄')} <strong>${escapeHtml(d.titel)}</strong>
        <div class="muted" style="font-size:.78rem">${escapeHtml(d.omschrijving || '')}</div></td>
      <td><span class="aa-badge ${d.zichtbaar ? 'aa-badge--aan' : 'aa-badge--uit'}">${d.zichtbaar ? 'zichtbaar' : 'verborgen'}</span></td>
      <td style="white-space:nowrap">
        <button type="button" class="aa-btn" data-actie="dl-bewerk" data-id="${d.id}">Bewerken</button>
        <button type="button" class="aa-btn aa-btn--rood" data-actie="dl-verwijder" data-id="${d.id}">Verwijderen</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="3" class="muted">Nog geen downloads.</td></tr>';

  const overlay = document.createElement('div');
  overlay.className = 'aa-overlay';
  overlay.innerHTML = `
    <div class="aa-editor" role="dialog" aria-modal="true" aria-label="Categorieën en downloads">
      <div class="aa-editor-kop">
        <h2>Categorieën &amp; downloads</h2>
        <button type="button" class="aa-sluit" data-actie="sluit" aria-label="Sluiten">×</button>
      </div>
      <div class="aa-editor-body">
        <div class="aa-sectie">Categorieën</div>
        <div class="aa-uitleg">
          <p><strong>Volgorde</strong> bepaalt waar de categorie op de pagina staat: het
          laagste getal komt bovenaan. De lijst hieronder staat al in die volgorde, zodat je
          ziet wat je verandert. Wil je een categorie hogerop? Geef hem een lager getal dan
          de categorie die er nu boven staat.</p>
          <p><strong>Binnenkort</strong> toont een "binnenkort"-blok in plaats van de
          producten. Een categorie zonder zichtbare producten toont dat blok sowieso.</p>
          <p><strong>Zichtbaar</strong> uit betekent dat de categorie helemaal van de pagina
          verdwijnt, inclusief haar producten.</p>
          <p class="aa-uitleg-let">Elke rij heeft een eigen Opslaan-knop — wijzig je meerdere
          rijen, sla ze dan één voor één op.</p>
        </div>
        <div class="aa-tabel-wrap"><table class="aa-tabel">
          <thead><tr>
            <th></th><th>Categorie</th><th>Volgorde</th><th>Weergave</th><th>Op de site</th><th></th>
          </tr></thead>
          <tbody>${catRijen}</tbody>
        </table></div>

        <div class="aa-sectie" style="display:flex;align-items:center;gap:1rem">
          Gratis downloads
          <button type="button" class="aa-btn" data-actie="dl-nieuw" style="margin-left:auto;text-transform:none;letter-spacing:0">+ Nieuwe download</button>
        </div>
        <div class="aa-tabel-wrap"><table class="aa-tabel"><tbody>${dlRijen}</tbody></table></div>

        <div id="aa-dl-form"></div>
      </div>
      <div class="aa-editor-voet">
        <button type="button" class="aa-btn aa-btn--stil" data-actie="sluit">Sluiten</button>
        <span id="aa-status" class="muted"></span>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.body.classList.add('aa-overlay-open');

  const sluit = async () => {
    overlay.remove();
    document.body.classList.remove('aa-overlay-open');
    await onKlaar();
  };

  overlay.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-actie]');
    if (!btn) return;
    const actie = btn.dataset.actie;
    const id = btn.dataset.id;

    if (actie === 'sluit') return sluit();

    if (actie === 'cat-opslaan') {
      try {
        await call('/categories/' + id, {
          method: 'PUT',
          body: {
            volgorde: overlay.querySelector(`.aa-cat-volgorde[data-id="${id}"]`).value,
            binnenkort: overlay.querySelector(`.aa-cat-binnenkort[data-id="${id}"]`).checked,
            zichtbaar: overlay.querySelector(`.aa-cat-zichtbaar[data-id="${id}"]`).checked,
          },
        });
        showToast('Categorie opgeslagen.', 'success');
        await laadBeheerdata();
      } catch (err) { showToast(err.message, 'error'); }
      return;
    }

    if (actie === 'dl-nieuw' || actie === 'dl-bewerk') {
      const d = actie === 'dl-bewerk' ? beheer.downloads.find(x => x.id === id) : null;
      toonDownloadForm(overlay, d);
      return;
    }

    if (actie === 'dl-opslaan') {
      const dlId = val(overlay, 'aa-dl-id');
      const payload = {
        titel: val(overlay, 'aa-dl-titel').trim(),
        emoji: val(overlay, 'aa-dl-emoji').trim(),
        omschrijving: val(overlay, 'aa-dl-oms').trim(),
        bestand_url: val(overlay, 'aa-dl-url').trim(),
        volgorde: val(overlay, 'aa-dl-volgorde') || 0,
        zichtbaar: checked(overlay, 'aa-dl-zichtbaar'),
      };
      if (!payload.titel) { showToast('Titel is verplicht.', 'error'); return; }
      try {
        if (dlId) await call('/downloads/' + dlId, { method: 'PUT', body: payload });
        else await call('/downloads', { method: 'POST', body: payload });
        showToast('Download opgeslagen.', 'success');
        await laadBeheerdata();
        sluit();
      } catch (err) { showToast(err.message, 'error'); }
      return;
    }

    if (actie === 'dl-verwijder') {
      const d = beheer.downloads.find(x => x.id === id);
      const ok = await confirmDialog(`"${d?.titel}" verwijderen?`);
      if (!ok) return;
      try {
        await call('/downloads/' + id, { method: 'DELETE' });
        showToast('Verwijderd.', 'success');
        await laadBeheerdata();
        sluit();
      } catch (err) { showToast(err.message, 'error'); }
    }
  });
}

function toonDownloadForm(overlay, d) {
  const v = d || {};
  overlay.querySelector('#aa-dl-form').innerHTML = `
    <div class="aa-sectie">${d ? 'Download bewerken' : 'Nieuwe download'}</div>
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
        <label class="aa-check"><input type="checkbox" id="aa-dl-zichtbaar" ${v.zichtbaar ? 'checked' : ''}> <strong>Zichtbaar</strong></label>
      </label>
    </div>
    <button type="button" class="aa-btn aa-btn--primair" data-actie="dl-opslaan">Download opslaan</button>`;
  overlay.querySelector('#aa-dl-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
