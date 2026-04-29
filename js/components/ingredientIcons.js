/* ============================================
   INGREDIËNT ICONEN BEHEER
   Admin-pagina voor het uploaden en beheren
   van iconen per ingrediënt. Toont alle unieke
   ingrediënten uit alle recepten, met upload-
   mogelijkheid en zoek/filter/sorteer functies.
============================================ */

import { getRecipes } from '../store.js?v=2.0.1';
import {
  supabaseFetch,
  uploadIngredientIcon,
  deleteIngredientIcon,
} from '../supabase.js?v=2.0.1';
import { showToast, escapeHtml } from '../utils.js?v=2.0.1';

/* ----------------------------------------
   STORAGE PAD SANITISATIE
   Zet een genormaliseerde ingrediënt-naam
   om naar een veilig bestandspad voor
   Supabase Storage. Verwijdert spaties,
   diakritische tekens en speciale karakters.
   Bijv. "maïs uit blik" → "mais-uit-blik.png"
---------------------------------------- */
function toStoragePath(normalized) {
  const safe = normalized
    .normalize('NFD')                       // splits ï → i + combining ¨
    .replace(/[\u0300-\u036f]/g, '')        // strip diakritische tekens
    .replace(/\s+/g, '-')                   // spaties → streepjes
    .replace(/[^a-z0-9._-]/gi, '');         // verwijder overige onveilige tekens
  return safe + '.png';
}

/* ----------------------------------------
   NORMALISATIE
   Maakt ingrediënt-namen uniform zodat
   "Tomaten", "tomaat", "tomaten" allemaal
   naar hetzelfde icoon verwijzen.
---------------------------------------- */
function normalizeIngredientName(name) {
  if (!name) return '';
  let n = name.toLowerCase().trim();

  /* 1a. Strip hoeveelheid-woorden aan het begin (zonder getal) */
  n = n.replace(
    /^(?:snuifje|snufje|snuf|scheutje|schepje|teentje(?:\(s\))?|sneetje(?:\(s\))?|takje(?:s)?|plakje(?:s)?|bosje|blaadje(?:s)?|handje(?:vol)?|beetje|stukje|blokje(?:s)?|potje|zakje|flesje|kopje|bakje)\s+/i,
    ''
  );

  /* 1b. Strip leidende hoeveelheden + eenheden:
     "100g havermout" → "havermout"
     "200 ml melk"   → "melk" */
  n = n.replace(/^[\d.,/]+\s*(?:gram|g|kg|ml|liter|l|dl|cl|eetlepel|eetlepels|el|theelepel|theelepels|tl|stuk|stuks|kopje|kopjes|snufje|scheutje|scheut|handvol|handje|blikje|blik|zakje|zakjes|plakje|plakjes|takje|takjes|sneetje|sneetjes|teen|teentje|druppel|mespunt)?\s*/i, '');

  /* 2. Strip ALLE haakjes-notities overal (inclusief "(s)", "(vegan)", "(vers of uit blik)") */
  n = n.replace(/\s*\([^)]*\)/g, '').trim();

  /* 3. Strip beschrijvende bijvoeglijke naamwoorden aan het begin */
  n = n.replace(
    /^(?:verse?|grof|grove|fijn|fijne|fijngemalen|geraspte?|gehakte?|gesneden|gedroogde?|gesmolten|gekookte?|gebakken|ontpitte?|groene?|rode?|gele|witte?|zwarte?|volle|halve|hele|biologische?|bio|grote?|kleine?)\s+/i,
    ''
  );

  /* 4. Strip " om te bakken/braden" etc. aan het einde */
  n = n.replace(/\s+om\s+te\s+\w+$/, '').trim();

  /* 5. Strip ", ontpit" etc. aan het einde */
  n = n.replace(/,\s*\w+$/, '').trim();

  /* 6. Strip niet-letter tekens aan begin/einde */
  n = n.replace(/^[^a-zà-ÿ]+|[^a-zà-ÿ]+$/g, '').trim();

  if (!n || n.length < 2) return '';

  /* 7. Strip Nederlandse meervoudsvormen
     NIET bij dubbele klinker + s (kaas, mees) */
  const doubleVowelS = /([aeiou])\1s$/.test(n);
  if (doubleVowelS) {
    // "kaas" etc. — niet strippen
  } else if (n.length > 4 && n.endsWith('en')) {
    n = n.slice(0, -2);
  } else if (n.endsWith("'s")) {
    n = n.slice(0, -2);
  } else if (n.length > 3 && n.endsWith('s')) {
    n = n.slice(0, -1);
  }

  /* 8. Strip verkleinwoorden (-tjes, -je) */
  if (n.endsWith('tjes')) {
    n = n.slice(0, -4);
  } else if (n.length > 4 && n.endsWith('je')) {
    n = n.slice(0, -2);
  }

  return n.trim();
}

/* ----------------------------------------
   RENDER
   Geeft de skeleton-HTML terug.
   De daadwerkelijke data wordt in init() geladen.
---------------------------------------- */
export function render() {
  return `
    <div class="recipe-form-container" id="ingredient-icons-page">
      <h2>Ingrediënt Iconen</h2>
      <p class="text-muted">Beheer iconen voor ingrediënten in de boodschappenlijst.</p>

      <!-- ======== BULK IMPORT VIA MAP ======== -->
      <div class="import-section" style="border-color:var(--color-primary);background:#fef9f5;margin-bottom:1.5rem">
        <h3 style="margin-bottom:0.5rem">&#128196; Bulk importeren via map</h3>
        <p class="text-muted" style="font-size:0.85rem;margin-bottom:1rem">
          Upload meerdere iconen tegelijk via een map met een CSV bestand en afbeeldingen.
        </p>

        <div style="background:var(--color-white);border:1px solid var(--color-light);border-radius:var(--radius-md);padding:1rem;margin-bottom:1rem;font-size:0.85rem">
          <strong>Hoe werkt het?</strong>
          <ol style="margin:0.5rem 0 0 1.2rem;padding:0;line-height:1.6">
            <li>Maak een map aan op je computer met daarin de afbeeldingen (bijv. <code>tomaat.png</code>, <code>kip.jpg</code>)</li>
            <li>Maak in diezelfde map een CSV bestand aan met twee kolommen:<br>
              <strong>Naam</strong> (ingrediënt) en <strong>Afbeelding</strong> (bestandsnaam)<br>
              <span class="text-muted">Voorbeeld: <code>tomaat;tomaat.png</code></span>
            </li>
            <li>Selecteer de map hieronder — de afbeeldingen worden automatisch verkleind naar 128×128px en geüpload</li>
          </ol>
        </div>

        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:1rem">
          <button class="btn btn-secondary" id="btn-download-icon-template">
            &#128229; Download lege CSV template
          </button>
          <button class="btn btn-secondary" id="btn-download-filled-template">
            &#128203; Download ingevulde CSV template
          </button>
        </div>

        <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;margin-bottom:0.75rem">
          <label style="font-weight:600;min-width:120px">&#128193; Selecteer map:</label>
          <input type="file" id="icon-folder-input" webkitdirectory
                 style="font-size:0.9rem">
        </div>

        <div id="icon-folder-status" style="font-size:0.85rem;margin-bottom:0.75rem"></div>

        <div>
          <button class="btn btn-primary" id="btn-bulk-import">
            Importeer iconen uit map
          </button>
        </div>
      </div>

      <hr style="border:none;border-top:2px solid var(--color-light);margin:1.5rem 0">

      <h3 style="margin-bottom:1rem">Alle ingrediënten</h3>

      <!-- Toolbar: zoek + sorteer -->
      <div class="ingredient-icons-toolbar">
        <input type="text" class="form-control" id="icon-search"
               placeholder="🔍 Zoek ingrediënt...">
        <select class="form-control" id="icon-sort">
          <option value="no-icon-first">Zonder icoon eerst</option>
          <option value="most-used">Meest gebruikt eerst</option>
          <option value="alphabetical">Alfabetisch</option>
        </select>
      </div>

      <!-- Statistieken -->
      <div id="icon-stats" class="text-muted" style="margin-bottom:1rem">Laden...</div>

      <!-- Grid met ingrediënten -->
      <div id="icon-grid"></div>
    </div>
  `;
}

/* ----------------------------------------
   INIT
   Haalt recepten + bestaande iconen op,
   bouwt het grid, koppelt event handlers.
---------------------------------------- */
export async function init() {
  /* --- 1. Data ophalen in parallel --- */
  const [recipes, existingIcons] = await Promise.all([
    getRecipes(),
    supabaseFetch('/rest/v1/ingredient_icons?select=*'),
  ]);

  /* --- 2. Unieke ingrediënten extraheren en normaliseren --- */
  // Map: normalized_name → { displayName, recipeCount }
  const ingredientMap = new Map();

  for (const recipe of recipes) {
    const ingredients = recipe.ingredients || [];
    // Track welke normalized names we al gezien hebben voor dit recept
    // (zodat we een recept niet dubbel tellen voor hetzelfde ingrediënt)
    const seenInRecipe = new Set();

    for (const ing of ingredients) {
      const rawName = (ing.name || '').trim();
      if (!rawName) continue;

      const normalized = normalizeIngredientName(rawName);
      if (!normalized) continue;

      if (!ingredientMap.has(normalized)) {
        // Gebruik de genormaliseerde naam als basis voor de weergave
        const display = normalized.charAt(0).toUpperCase() + normalized.slice(1);
        ingredientMap.set(normalized, {
          displayName: display,
          recipeCount: 0,
        });
      }

      // Tel elk recept maar 1x per ingrediënt
      if (!seenInRecipe.has(normalized)) {
        ingredientMap.get(normalized).recipeCount++;
        seenInRecipe.add(normalized);
      }
    }
  }

  /* --- 3. Bestaande iconen koppelen --- */
  const iconUrlMap = new Map();
  for (const row of (existingIcons || [])) {
    iconUrlMap.set(row.name, row.icon_url);
  }

  /* --- 4. Lijst bouwen --- */
  let ingredientList = Array.from(ingredientMap.entries()).map(([normalized, info]) => ({
    normalized,
    displayName: info.displayName,
    recipeCount: info.recipeCount,
    iconUrl: iconUrlMap.get(normalized) || null,
  }));

  /* --- 5. Grid renderen en events koppelen --- */
  const gridEl = document.getElementById('icon-grid');
  const statsEl = document.getElementById('icon-stats');
  const searchEl = document.getElementById('icon-search');
  const sortEl = document.getElementById('icon-sort');

  function updateStats(list) {
    const withIcon = list.filter(i => i.iconUrl).length;
    statsEl.textContent = `${withIcon} van ${list.length} ingrediënten hebben een icoon`;
  }

  function sortList(list, mode) {
    const sorted = [...list];
    switch (mode) {
      case 'no-icon-first':
        sorted.sort((a, b) => {
          // Zonder icoon eerst, dan alfabetisch
          if (!a.iconUrl && b.iconUrl) return -1;
          if (a.iconUrl && !b.iconUrl) return 1;
          return a.displayName.localeCompare(b.displayName);
        });
        break;
      case 'most-used':
        sorted.sort((a, b) => b.recipeCount - a.recipeCount || a.displayName.localeCompare(b.displayName));
        break;
      case 'alphabetical':
        sorted.sort((a, b) => a.displayName.localeCompare(b.displayName));
        break;
    }
    return sorted;
  }

  function renderGrid(list) {
    if (list.length === 0) {
      gridEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🥕</div>
          <h3>Geen ingrediënten gevonden</h3>
          <p>Importeer eerst recepten om ingrediënten te zien.</p>
        </div>
      `;
      return;
    }

    gridEl.innerHTML = list.map(item => `
      <div class="icon-grid-item ${item.iconUrl ? 'has-icon' : ''}" data-name="${escapeHtml(item.normalized)}">
        <div class="icon-grid-preview">
          ${item.iconUrl
            ? `<img src="${escapeHtml(item.iconUrl)}" alt="${escapeHtml(item.displayName)}" class="icon-grid-img">`
            : `<span class="icon-grid-placeholder">?</span>`
          }
        </div>
        <div class="icon-grid-info">
          <span class="icon-grid-name">${escapeHtml(item.displayName)}</span>
          <span class="icon-grid-count">${item.recipeCount} ${item.recipeCount === 1 ? 'recept' : 'recepten'}</span>
        </div>
        <div class="icon-grid-actions">
          <label class="btn btn-sm btn-outline icon-upload-label">
            ${item.iconUrl ? 'Wijzig' : 'Upload'}
            <input type="file" accept="image/*" class="icon-upload-input"
                   data-name="${escapeHtml(item.normalized)}" style="display:none">
          </label>
          ${item.iconUrl ? `
            <button class="btn btn-sm btn-outline icon-delete-btn"
                    data-name="${escapeHtml(item.normalized)}"
                    style="color:var(--color-danger)">
              Verwijder
            </button>
          ` : ''}
        </div>
      </div>
    `).join('');
  }

  function applyFilterAndSort() {
    const query = (searchEl.value || '').toLowerCase().trim();
    const mode = sortEl.value;

    let filtered = ingredientList;
    if (query) {
      filtered = ingredientList.filter(i =>
        i.normalized.includes(query) || i.displayName.toLowerCase().includes(query)
      );
    }

    const sorted = sortList(filtered, mode);
    renderGrid(sorted);
    updateStats(ingredientList); // Stats altijd over volledige lijst
  }

  /* --- Initieel renderen --- */
  applyFilterAndSort();

  /* --- Event handlers --- */
  searchEl.addEventListener('input', applyFilterAndSort);
  sortEl.addEventListener('change', applyFilterAndSort);

  /* Upload handler (event delegation) */
  gridEl.addEventListener('change', async (e) => {
    const input = e.target.closest('.icon-upload-input');
    if (!input) return;

    const file = input.files[0];
    if (!file) return;

    const normalized = input.dataset.name;
    input.value = ''; // Reset zodat hetzelfde bestand opnieuw geselecteerd kan worden

    try {
      /* Resize naar 128x128 met Canvas (center crop) */
      const blob = await resizeImage(file, 128, 128);

      /* Upload naar Supabase Storage (gesanitiseerd pad) */
      const iconUrl = await uploadIngredientIcon(toStoragePath(normalized), blob);

      /* UPSERT in ingredient_icons tabel (on_conflict=name voor merge) */
      await supabaseFetch('/rest/v1/ingredient_icons?on_conflict=name', {
        method: 'POST',
        body: {
          name: normalized,
          icon_url: iconUrl,
          updated_at: new Date().toISOString(),
        },
        headers: {
          'Prefer': 'return=representation,resolution=merge-duplicates',
        },
      });

      /* Update lokale data */
      const item = ingredientList.find(i => i.normalized === normalized);
      if (item) item.iconUrl = iconUrl;

      applyFilterAndSort();
      showToast(`Icoon voor "${normalized}" opgeslagen!`);
    } catch (err) {
      console.error('Upload fout:', err);
      showToast('Upload mislukt: ' + err.message, 'error');
    }
  });

  /* ======== BULK IMPORT HANDLERS ======== */

  /* Template download */
  document.getElementById('btn-download-icon-template')?.addEventListener('click', () => {
    const template = `Naam;Afbeelding
tomaat;tomaat.png
aardappel;aardappel.jpg
kip;kip.png
ui;ui.png`;
    const blob = new Blob(['\uFEFF' + template], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'iconen-template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('CSV template gedownload!');
  });

  /* Ingevulde template download (alle ingrediënten van de website) */
  document.getElementById('btn-download-filled-template')?.addEventListener('click', () => {
    if (ingredientList.length === 0) {
      showToast('Geen ingrediënten gevonden om te exporteren.', 'error');
      return;
    }

    /* Sorteer alfabetisch */
    const sorted = [...ingredientList].sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );

    /* Bouw CSV met alle ingrediënten
       Gebruik .png als standaard extensie — de bulk import
       matcht ook op basisnaam, dus .jpg/.webp etc. werkt ook */
    const rows = sorted.map(item =>
      `${item.displayName};${item.normalized}.png`
    );
    const csv = `Naam;Afbeelding\n${rows.join('\n')}`;

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'iconen-alle-ingredienten.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`CSV met ${sorted.length} ingrediënten gedownload!`);
  });

  /* Folder status */
  document.getElementById('icon-folder-input')?.addEventListener('change', () => {
    const folderInput = document.getElementById('icon-folder-input');
    const statusEl = document.getElementById('icon-folder-status');
    if (!folderInput || !statusEl) return;

    const files = Array.from(folderInput.files);
    if (files.length === 0) { statusEl.textContent = ''; return; }

    const csvFiles = files.filter(f => f.name.toLowerCase().endsWith('.csv'));
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'];
    const imageFiles = files.filter(f =>
      (f.type && f.type.startsWith('image/')) ||
      imageExts.some(ext => f.name.toLowerCase().endsWith(ext))
    );

    let html = '';
    if (csvFiles.length >= 1) {
      html += `<span style="color:var(--color-success)">&#10003; CSV gevonden: <strong>${csvFiles[0].name}</strong></span><br>`;
    } else {
      html += `<span style="color:var(--color-info)">&#8505; Geen CSV — bestandsnamen worden als ingrediënt-naam gebruikt</span><br>`;
    }
    html += `<span style="color:var(--color-success)">&#10003; ${imageFiles.length} afbeelding(en) gevonden</span>`;
    if (imageFiles.length > 0) {
      const sampleNames = imageFiles.slice(0, 3).map(f => f.name).join(', ');
      html += `<br><span style="font-size:0.8rem;color:var(--color-gray)">Bijv.: ${sampleNames}${imageFiles.length > 3 ? ' ...' : ''}</span>`;
    }
    statusEl.innerHTML = html;
  });

  /* Bulk import uitvoeren */
  document.getElementById('btn-bulk-import')?.addEventListener('click', async () => {
    const folderInput = document.getElementById('icon-folder-input');
    const statusEl = document.getElementById('icon-folder-status');
    const importBtn = document.getElementById('btn-bulk-import');
    const files = Array.from(folderInput?.files || []);

    if (files.length === 0) {
      showToast('Selecteer eerst een map', 'error');
      return;
    }

    const csvFile = files.find(f => f.name.toLowerCase().endsWith('.csv'));
    const imageExtsImport = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'];
    const imageFiles = files.filter(f =>
      (f.type && f.type.startsWith('image/')) ||
      imageExtsImport.some(ext => f.name.toLowerCase().endsWith(ext))
    );

    if (imageFiles.length === 0) {
      showToast('Geen afbeeldingen gevonden in de map', 'error');
      return;
    }

    try {
      if (importBtn) importBtn.disabled = true;

      /* --- Helper: NFC-normalisatie voor macOS compatibiliteit ---
         macOS (HFS+/APFS) slaat bestandsnamen op in NFD Unicode-vorm,
         terwijl JavaScript strings typisch NFC gebruiken.
         Bijv. "maïs" kan als 2 vormen bestaan die er identiek uitzien
         maar technisch verschillende byte-sequenties zijn. */
      const nfc = (s) => s.normalize('NFC').toLowerCase().trim();

      /* --- Bouw lookup van afbeeldings-bestanden ---
         3 niveaus van matching:
         1) Exact match op volledige bestandsnaam (bijv. "tomaat.png")
         2) Match op basisnaam zonder extensie (bijv. "tomaat")
         3) Match op genormaliseerde ingrediënt-naam */
      const fileMap = {};
      const baseNameMap = {};
      for (const imgFile of imageFiles) {
        const fullName = nfc(imgFile.name);
        fileMap[fullName] = imgFile;

        const baseName = fullName.replace(/\.[^.]+$/, '');
        if (!baseNameMap[baseName]) {
          baseNameMap[baseName] = imgFile;
        }
      }

      /* --- Bepaal rijen: uit CSV of automatisch uit bestandsnamen --- */
      let rows = [];

      if (csvFile) {
        statusEl.innerHTML = `<span style="color:var(--color-primary)">&#9203; CSV wordt gelezen...</span>`;

        /* Lees CSV */
        const csvText = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = () => reject(new Error('Kon CSV niet lezen'));
          reader.readAsText(csvFile, 'UTF-8');
        });

        /* Parse CSV: elke rij = naam;afbeelding */
        const lines = csvText.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(l => l.trim());

        for (const line of lines) {
          const sep = line.includes(';') ? ';' : ',';
          const cols = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
          if (cols.length < 2 || !cols[0] || !cols[1]) continue;
          if (cols[0].toLowerCase() === 'naam') continue;
          rows.push({ ingredientName: cols[0], imageFileName: cols[1] });
        }
      }

      /* Als er geen CSV is (of CSV was leeg), gebruik bestandsnamen als ingrediënt-namen */
      if (rows.length === 0) {
        statusEl.innerHTML = `<span style="color:var(--color-primary)">&#9203; Geen CSV gevonden — bestandsnamen worden als ingrediënt-naam gebruikt...</span>`;
        for (const imgFile of imageFiles) {
          const baseName = imgFile.name.replace(/\.[^.]+$/, '');
          if (baseName) {
            rows.push({ ingredientName: baseName, imageFileName: imgFile.name });
          }
        }
      }

      if (rows.length === 0) {
        showToast('Geen ingrediënten gevonden om te importeren', 'error');
        if (importBtn) importBtn.disabled = false;
        return;
      }

      /* --- Verwerk elke rij --- */
      let uploaded = 0;
      let skipped = 0;
      let normFailed = 0;
      const notFound = [];
      const uploadErrors = [];

      for (let i = 0; i < rows.length; i++) {
        const { ingredientName, imageFileName } = rows[i];
        const normalized = normalizeIngredientName(ingredientName);
        if (!normalized) {
          normFailed++;
          skipped++;
          console.warn(`Normalisatie mislukt voor: "${ingredientName}"`);
          continue;
        }

        /* Zoek afbeelding: exact → basisnaam → genormaliseerde naam (alle met NFC) */
        const csvNameNfc = nfc(imageFileName);
        const csvBaseNfc = csvNameNfc.replace(/\.[^.]+$/, '');
        const normalizedNfc = nfc(normalized);
        const imgFile = fileMap[csvNameNfc]
          || baseNameMap[csvBaseNfc]
          || baseNameMap[normalizedNfc];

        if (!imgFile) {
          console.warn(`Afbeelding niet gevonden: ${imageFileName} (gezocht: "${csvNameNfc}", "${csvBaseNfc}", "${normalizedNfc}")`);
          notFound.push(ingredientName);
          skipped++;
          continue;
        }

        statusEl.innerHTML = `<span style="color:var(--color-primary)">&#9203; Uploaden ${i + 1}/${rows.length}: ${escapeHtml(normalized)}...</span>`;

        try {
          /* Resize naar 128x128 */
          const blob = await resizeImage(imgFile, 128, 128);

          /* Upload naar Storage (gesanitiseerd pad) */
          const iconUrl = await uploadIngredientIcon(toStoragePath(normalized), blob);

          /* UPSERT in tabel (on_conflict=name voor merge bij duplicaten) */
          await supabaseFetch('/rest/v1/ingredient_icons?on_conflict=name', {
            method: 'POST',
            body: {
              name: normalized,
              icon_url: iconUrl,
              updated_at: new Date().toISOString(),
            },
            headers: {
              'Prefer': 'return=representation,resolution=merge-duplicates',
            },
          });

          /* Update lokale data */
          const item = ingredientList.find(i => i.normalized === normalized);
          if (item) item.iconUrl = iconUrl;

          uploaded++;
        } catch (uploadErr) {
          const errMsg = uploadErr?.message || String(uploadErr);
          console.error(`Upload fout bij "${normalized}":`, uploadErr);
          if (uploadErrors.length < 3) {
            uploadErrors.push({ name: normalized, error: errMsg });
          }
          skipped++;
        }
      }

      /* Klaar! */
      folderInput.value = '';
      let resultHtml = `<span style="color:${uploaded > 0 ? 'var(--color-success)' : 'var(--color-danger)'}">
        ${uploaded > 0 ? '&#10003;' : '&#10007;'} ${uploaded} icoon/iconen geüpload${skipped > 0 ? `, ${skipped} overgeslagen` : ''}
      </span>`;
      resultHtml += `<br><span style="font-size:0.8rem;color:var(--color-gray)">${rows.length} rijen verwerkt, ${imageFiles.length} afbeeldingen in map</span>`;

      /* Toon normalisatie-fouten */
      if (normFailed > 0) {
        resultHtml += `<br><span style="color:var(--color-warning);font-size:0.8rem">
          ⚠ ${normFailed} ingrediënt-namen konden niet genormaliseerd worden
        </span>`;
      }

      /* Toon upload-fouten */
      if (uploadErrors.length > 0) {
        resultHtml += `<br><span style="color:var(--color-danger);font-size:0.8rem">
          <strong>Upload fouten:</strong><br>
          ${uploadErrors.map(e => `"${escapeHtml(e.name)}": ${escapeHtml(e.error)}`).join('<br>')}
          ${skipped - notFound.length - normFailed > uploadErrors.length ? `<br>...en meer` : ''}
        </span>`;
      }

      /* Toon niet-gevonden bestanden */
      if (notFound.length > 0) {
        const shown = notFound.slice(0, 5);
        resultHtml += `<br><span style="color:var(--color-danger);font-size:0.8rem">
          <strong>Niet gevonden:</strong> ${shown.map(n => `"${escapeHtml(n)}"`).join(', ')}${notFound.length > 5 ? ` en ${notFound.length - 5} meer...` : ''}
        </span>`;
        const sampleFiles = imageFiles.slice(0, 3).map(f => f.name);
        resultHtml += `<br><span style="color:var(--color-gray);font-size:0.8rem">
          Bestanden in map: ${sampleFiles.map(n => `"${escapeHtml(n)}"`).join(', ')}${imageFiles.length > 3 ? ` ...` : ''}
          <br>Tip: bestandsnamen moeten overeenkomen met ingrediënt-namen (extensie mag verschillen).
        </span>`;
      }

      statusEl.innerHTML = resultHtml;
      applyFilterAndSort();
      showToast(`${uploaded} icoon/iconen geïmporteerd!${skipped > 0 ? ` ${skipped} overgeslagen.` : ''}`);
    } catch (err) {
      console.error('Bulk import fout:', err);
      showToast('Import mislukt: ' + err.message, 'error');
    } finally {
      if (importBtn) importBtn.disabled = false;
    }
  });

  /* Delete handler (event delegation) */
  gridEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.icon-delete-btn');
    if (!btn) return;

    const normalized = btn.dataset.name;
    if (!confirm(`Icoon voor "${normalized}" verwijderen?`)) return;

    try {
      /* Verwijder uit Storage (gesanitiseerd pad) */
      await deleteIngredientIcon(toStoragePath(normalized));

      /* Verwijder uit tabel */
      await supabaseFetch(
        `/rest/v1/ingredient_icons?name=eq.${encodeURIComponent(normalized)}`,
        { method: 'DELETE', prefer: 'return=minimal' }
      );

      /* Update lokale data */
      const item = ingredientList.find(i => i.normalized === normalized);
      if (item) item.iconUrl = null;

      applyFilterAndSort();
      showToast(`Icoon voor "${normalized}" verwijderd.`, 'info');
    } catch (err) {
      console.error('Verwijder fout:', err);
      showToast('Verwijderen mislukt: ' + err.message, 'error');
    }
  });
}

/* ----------------------------------------
   RESIZE IMAGE
   Verkleint een afbeelding naar exact
   width × height pixels via Canvas.
   Gebruikt center-crop voor een vierkante
   uitsnede uit de originele afbeelding.
---------------------------------------- */
function resizeImage(file, width, height) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      /* Center-crop: schaal zodat de kleinste zijde past,
         en snij het overschot af van het midden */
      const scale = Math.max(width / img.width, height / img.height);
      const sw = width / scale;
      const sh = height / scale;
      const sx = (img.width - sw) / 2;
      const sy = (img.height - sh) / 2;

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob mislukt'));
        },
        'image/png'
      );

      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Afbeelding laden mislukt'));
    img.src = URL.createObjectURL(file);
  });
}
