/* ============================================
   IMPORT RECIPES COMPONENT
   Biedt een interface om recepten te importeren
   via een map met CSV en afbeeldingen.

   CSV FORMAAT:
   - Kolom-scheidingsteken: puntkomma (;) of komma (,)
     wordt automatisch gedetecteerd
   - Header-rij is optioneel (wordt automatisch gedetecteerd)
   - Meerdere waarden in één cel: komma (,)
   - Ingrediënten: pipe (|) gescheiden
   - Bereidingsstappen: pipe (|) gescheiden

   Async patroon:
   - render() geeft een skeleton terug
   - init() haalt de bestaande recepten op om
     de beheer-lijst op te bouwen
   - importFromFolder uploadt afbeeldingen
     naar Supabase Storage in plaats van base64
============================================ */

import * as Store from '../store.js';
import * as Router from '../router.js';
import { supabaseStorageUpload } from '../supabase.js';
import { showToast, confirm, escapeHtml, getMealMomentLabel } from '../utils.js';

/* ----------------------------------------
   STATE / CACHE
---------------------------------------- */
let cachedRecipes = [];

/* ----------------------------------------
   RENDER (skeleton)
---------------------------------------- */
export function render() {
  return `
    <div class="recipe-form-container" id="import-page">
      <h2>Recepten Importeren</h2>

      <!-- ======== MAP IMPORT ======== -->
      <div class="import-section" style="border-color:var(--color-primary);background:#fef9f5">
        <h3 style="margin-bottom:0.5rem">&#128196; Importeer via map</h3>
        <p class="text-muted" style="font-size:0.85rem;margin-bottom:1rem">
          Selecteer een map die een CSV bestand en de bijbehorende afbeeldingen bevat.<br>
          Het CSV bestand en de afbeeldingen worden automatisch herkend.
        </p>

        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:1rem">
          <button class="btn btn-secondary" id="btn-download-csv-template">
            &#128229; Download CSV Template
          </button>
        </div>

        <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;margin-bottom:0.75rem">
          <label style="font-weight:600;min-width:120px">&#128193; Selecteer map:</label>
          <input type="file" id="folder-input" webkitdirectory
                 style="font-size:0.9rem">
        </div>

        <div id="folder-status" style="font-size:0.85rem;margin-bottom:0.75rem"></div>

        <div>
          <button class="btn btn-primary" id="btn-import-csv">
            Importeer recepten uit map
          </button>
        </div>
      </div>

      <!-- ======== RECEPTEN BEHEREN ======== -->
      <div class="import-section mt-2" style="border-color:var(--color-secondary);background:#f9faf5">
        <h3 style="margin-bottom:0.5rem">&#9998; Recepten Beheren</h3>
        <p class="text-muted" style="font-size:0.85rem;margin-bottom:1rem">
          Bewerk of verwijder individuele recepten.
        </p>

        <div id="manage-recipes-list">
          <p class="text-muted" style="font-size:0.85rem">Recepten laden...</p>
        </div>

        <div id="delete-all-container" style="display:none">
          <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--color-light)">
            <button class="btn btn-danger" id="btn-delete-all">
              &#128465; Verwijder Alle Recepten
            </button>
          </div>
        </div>
      </div>

      <!-- CSV kolom uitleg -->
      <div class="recipe-section mt-2">
        <h3>CSV Kolommen Uitleg</h3>
        <table style="width:100%;font-size:0.85rem;border-collapse:collapse">
          <thead>
            <tr style="text-align:left;border-bottom:2px solid var(--color-light)">
              <th style="padding:0.5rem">Kolom</th>
              <th style="padding:0.5rem">Formaat</th>
              <th style="padding:0.5rem">Voorbeeld</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom:1px solid var(--color-light)">
              <td style="padding:0.5rem"><strong>Naam</strong></td>
              <td style="padding:0.5rem">Tekst</td>
              <td style="padding:0.5rem">Spaghetti Bolognese</td>
            </tr>
            <tr style="border-bottom:1px solid var(--color-light)">
              <td style="padding:0.5rem"><strong>Afbeelding</strong></td>
              <td style="padding:0.5rem">Bestandsnaam of URL</td>
              <td style="padding:0.5rem">Mijn Recept.jpeg</td>
            </tr>
            <tr style="border-bottom:1px solid var(--color-light)">
              <td style="padding:0.5rem"><strong>Eetmomenten</strong></td>
              <td style="padding:0.5rem">Komma-gescheiden</td>
              <td style="padding:0.5rem">middag, avond<br><em style="font-size:0.8rem">(ochtend, fruit moment, middag, snack, avond)</em></td>
            </tr>
            <tr style="border-bottom:1px solid var(--color-light)">
              <td style="padding:0.5rem"><strong>Kooktijd</strong></td>
              <td style="padding:0.5rem">Getal (minuten)</td>
              <td style="padding:0.5rem">45</td>
            </tr>
            <tr style="border-bottom:1px solid var(--color-light)">
              <td style="padding:0.5rem"><strong>Ingredienten</strong></td>
              <td style="padding:0.5rem">Pipe-gescheiden (|)<br><em>naam: hoev. eenheid</em><br>of <em>hoev. eenheid naam</em></td>
              <td style="padding:0.5rem">spaghetti: 300 gram | gehakt: 400 gram<br><em style="font-size:0.8rem">of: 300 gram spaghetti | 400 gram gehakt</em></td>
            </tr>
            <tr style="border-bottom:1px solid var(--color-light)">
              <td style="padding:0.5rem"><strong>Allergenen</strong></td>
              <td style="padding:0.5rem">Komma-gescheiden</td>
              <td style="padding:0.5rem">gluten, lactose</td>
            </tr>
            <tr>
              <td style="padding:0.5rem"><strong>Bereiding</strong></td>
              <td style="padding:0.5rem">Pipe-gescheiden (|)</td>
              <td style="padding:0.5rem">Kook de pasta. | Bak het gehakt.</td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  `;
}

/* ----------------------------------------
   INIT
---------------------------------------- */
export async function init() {
  /* ---- Recepten ophalen voor de beheer-lijst ---- */
  try {
    cachedRecipes = await Store.getRecipes();
  } catch (err) {
    showToast('Fout bij laden recepten: ' + err.message, 'error');
    cachedRecipes = [];
  }

  const manageList = document.getElementById('manage-recipes-list');
  if (manageList) {
    manageList.innerHTML = renderRecipeManageList();
  }

  const deleteAllContainer = document.getElementById('delete-all-container');
  if (deleteAllContainer) {
    deleteAllContainer.style.display = cachedRecipes.length > 0 ? '' : 'none';
  }

  /* ---- Listeners ---- */
  document.getElementById('btn-download-csv-template')?.addEventListener('click', downloadCsvTemplate);
  document.getElementById('btn-import-csv')?.addEventListener('click', importFromFolder);
  document.getElementById('folder-input')?.addEventListener('change', showFolderStatus);
  document.getElementById('btn-delete-all')?.addEventListener('click', handleDeleteAll);

  /* Receptbeheer: bewerk en verwijder knoppen */
  if (manageList) {
    manageList.addEventListener('click', async (e) => {
      const editBtn = e.target.closest('.btn-edit-single');
      if (editBtn) {
        Router.navigate('edit/' + editBtn.dataset.id);
        return;
      }

      const deleteBtn = e.target.closest('.btn-delete-single');
      if (deleteBtn) {
        const id = deleteBtn.dataset.id;
        const name = deleteBtn.dataset.name;
        const ok = await confirm(`Weet je zeker dat je "${name}" wilt verwijderen?`);
        if (!ok) return;

        try {
          await Store.deleteRecipe(id);
          showToast(`"${name}" verwijderd`, 'info');
          /* Cache bijwerken en lijst herladen */
          cachedRecipes = cachedRecipes.filter(r => r.id !== id);
          manageList.innerHTML = renderRecipeManageList();
          if (deleteAllContainer && cachedRecipes.length === 0) {
            deleteAllContainer.style.display = 'none';
          }
        } catch (err) {
          showToast('Fout bij verwijderen: ' + err.message, 'error');
        }
      }
    });
  }
}

/* ----------------------------------------
   VERWIJDER ALLE RECEPTEN
---------------------------------------- */
async function handleDeleteAll() {
  const ok = await confirm('Weet je zeker dat je ALLE recepten wilt verwijderen? Dit kan niet ongedaan gemaakt worden.');
  if (!ok) return;

  try {
    await Store.deleteAllRecipes();
    showToast('Alle recepten verwijderd', 'info');
    Router.navigate('');
  } catch (err) {
    showToast('Fout bij verwijderen: ' + err.message, 'error');
  }
}

/* ============================================
   RECEPTEN BEHEER LIJST
============================================ */

function renderRecipeManageList() {
  if (cachedRecipes.length === 0) {
    return '<p class="text-muted" style="font-size:0.85rem">Geen recepten om te beheren. Importeer eerst recepten.</p>';
  }

  const rows = cachedRecipes.map(r => {
    const moments = (r.mealMoments || []).map(m => getMealMomentLabel(m)).join(', ');
    return `
      <div class="manage-recipe-row" style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid var(--color-light)">
        <div style="flex:1;min-width:0">
          <strong style="font-size:0.9rem">${escapeHtml(r.name)}</strong>
          ${moments ? `<span class="text-muted" style="font-size:0.8rem;margin-left:0.5rem">${escapeHtml(moments)}</span>` : ''}
        </div>
        <button class="btn btn-outline btn-sm btn-edit-single" data-id="${r.id}" style="white-space:nowrap">&#9998; Bewerken</button>
        <button class="btn btn-danger btn-sm btn-delete-single" data-id="${r.id}" data-name="${escapeHtml(r.name)}" style="white-space:nowrap">&#128465;</button>
      </div>
    `;
  }).join('');

  return `
    <div style="font-size:0.85rem;color:var(--color-muted);margin-bottom:0.5rem">${cachedRecipes.length} recept(en)</div>
    <div style="max-height:400px;overflow-y:auto">${rows}</div>
  `;
}

/* ============================================
   CSV FUNCTIES
============================================ */

function downloadCsvTemplate() {
  const template = `Naam;Afbeelding;Eetmomenten;Kooktijd;Ingredienten;Allergenen;Bereiding
Voorbeeld Recept;https://voorbeeld.com/foto.jpg;ochtend, middag;30;bloem: 250 gram | eieren: 3 stuks | melk: 500 ml;gluten, ei, lactose;Meng alle droge ingredienten. | Voeg de natte ingredienten toe. | Bak in een voorverwarmde oven.
Voorbeeld Fruit Moment;https://voorbeeld.com/fruit.jpg;fruit moment;5;appel: 2 stuks | kaneel: 1 theelepel;;Snijd het fruit. | Bestrooi met kaneel.`;

  downloadFile('recepten-template.csv', template);
  showToast('CSV template gedownload!');
}

function downloadFile(filename, content) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function showFolderStatus() {
  const folderInput = document.getElementById('folder-input');
  const statusEl = document.getElementById('folder-status');
  if (!folderInput || !statusEl) return;

  const files = Array.from(folderInput.files);
  if (files.length === 0) {
    statusEl.textContent = '';
    return;
  }

  const csvFiles = files.filter(f => f.name.toLowerCase().endsWith('.csv'));
  const imageFiles = files.filter(f => f.type && f.type.startsWith('image/'));

  let html = '';
  if (csvFiles.length === 1) {
    html += `<span style="color:var(--color-success)">&#10003; CSV gevonden: <strong>${csvFiles[0].name}</strong></span><br>`;
  } else if (csvFiles.length === 0) {
    html += `<span style="color:var(--color-danger)">&#10007; Geen CSV bestand gevonden in de map</span><br>`;
  } else {
    html += `<span style="color:var(--color-warning)">&#9888; ${csvFiles.length} CSV bestanden gevonden, eerste wordt gebruikt: <strong>${csvFiles[0].name}</strong></span><br>`;
  }

  if (imageFiles.length > 0) {
    html += `<span style="color:var(--color-success)">&#10003; ${imageFiles.length} afbeelding(en) gevonden</span>`;
  } else {
    html += `<span class="text-muted">Geen afbeeldingen gevonden in de map</span>`;
  }

  statusEl.innerHTML = html;
}

/* ----------------------------------------
   AFBEELDING VERKLEINEN -> Blob
   Verkleint via canvas en geeft een Blob terug
   die we direct naar Supabase Storage uploaden.
---------------------------------------- */
function resizeImageFileToBlob(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = Math.round(h * maxWidth / w);
          w = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error('Kon blob niet aanmaken')),
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => reject(new Error('Kon afbeelding niet laden'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Kon bestand niet lezen'));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Kon het bestand niet lezen'));
    reader.readAsText(file, 'UTF-8');
  });
}

/* ----------------------------------------
   IMPORTEER VANUIT MAP
   Leest CSV, upload afbeeldingen naar Supabase
   Storage en slaat alles op via Store.importRecipes
---------------------------------------- */
async function importFromFolder() {
  const folderInput = document.getElementById('folder-input');
  const files = Array.from(folderInput?.files || []);

  if (files.length === 0) {
    showToast('Selecteer eerst een map', 'error');
    return;
  }

  const csvFile = files.find(f => f.name.toLowerCase().endsWith('.csv'));
  const imageFiles = files.filter(f => f.type && f.type.startsWith('image/'));

  if (!csvFile) {
    showToast('Geen CSV bestand gevonden in de map', 'error');
    return;
  }

  const statusEl = document.getElementById('folder-status');
  const importBtn = document.getElementById('btn-import-csv');

  try {
    if (importBtn) importBtn.disabled = true;
    if (statusEl) {
      statusEl.innerHTML = `<span style="color:var(--color-primary)">&#9203; CSV wordt gelezen...</span>`;
    }

    const csvText = await readFileAsText(csvFile);
    const recipes = parseCsv(csvText);

    if (recipes.length === 0) {
      showToast('Geen recepten gevonden in het bestand. Controleer het formaat.', 'error');
      if (importBtn) importBtn.disabled = false;
      return;
    }

    /* ---- Afbeeldingen uploaden naar Supabase Storage ---- */
    if (imageFiles.length > 0) {
      const fileMap = {};
      for (const imgFile of imageFiles) {
        fileMap[imgFile.name.toLowerCase()] = imgFile;
      }

      let uploaded = 0;

      for (let i = 0; i < recipes.length; i++) {
        const imageRef = recipes[i].image;
        if (!imageRef) continue;

        /* Sla over als het al een URL is */
        if (imageRef.startsWith('http://') || imageRef.startsWith('https://') || imageRef.startsWith('data:')) {
          continue;
        }

        const lookupName = imageRef.toLowerCase();
        const imgFile = fileMap[lookupName];

        if (imgFile) {
          if (statusEl) {
            statusEl.innerHTML = `<span style="color:var(--color-primary)">&#9203; Uploaden ${uploaded + 1}: ${escapeHtml(recipes[i].name)}...</span>`;
          }

          try {
            const blob = await resizeImageFileToBlob(imgFile);
            const safeName = recipes[i].name
              .replace(/\s+/g, '-')
              .replace(/[^a-zA-Z0-9\-]/g, '')
              .toLowerCase();
            const fileName = `${Date.now()}-${i}-${safeName}.jpg`;
            const publicUrl = await supabaseStorageUpload(`recipes/${fileName}`, blob);
            recipes[i].image = publicUrl;
            uploaded++;
          } catch (uploadErr) {
            console.warn('Fout bij uploaden afbeelding:', uploadErr);
            recipes[i].image = '';
          }
        } else {
          /* Geen bijbehorend bestand -> leeg laten */
          recipes[i].image = '';
        }
      }

      if (statusEl) {
        statusEl.innerHTML = `<span style="color:var(--color-success)">&#10003; ${uploaded} afbeelding(en) geüpload</span>`;
      }
    }

    /* ---- Opslaan in Supabase via Store ---- */
    if (statusEl) {
      statusEl.innerHTML += `<br><span style="color:var(--color-primary)">&#9203; Recepten opslaan...</span>`;
    }

    const count = await Store.importRecipes(recipes);
    folderInput.value = '';
    showToast(`${count} recept(en) geïmporteerd!`);
    Router.navigate('');
  } catch (error) {
    console.error('Import fout:', error);
    showToast('Fout bij het verwerken: ' + error.message, 'error');
    if (importBtn) importBtn.disabled = false;
  }
}

/* ============================================
   CSV PARSER (ongewijzigd)
============================================ */

function detectDelimiter(firstLine) {
  const semiCols = splitCsvRow(firstLine, ';');
  if (semiCols.length >= 7) return ';';

  const commaCols = splitCsvRow(firstLine, ',');
  if (commaCols.length >= 7) return ',';

  return semiCols.length >= commaCols.length ? ';' : ',';
}

function hasHeaderRow(firstRow) {
  if (!firstRow || firstRow.length === 0) return false;
  const first = firstRow[0].toLowerCase().trim().replace(/ë/g, 'e');
  return first === 'naam';
}

function parseCsv(csvText) {
  const text = csvText.replace(/^\uFEFF/, '').trim();
  const lines = splitCsvLines(text).filter(line => line.trim() !== '');

  if (lines.length < 1) {
    throw new Error('CSV bestand is leeg');
  }

  const delimiter = detectDelimiter(lines[0]);
  const firstRow = splitCsvRow(lines[0], delimiter);
  const isHeader = hasHeaderRow(firstRow);

  const expectedHeaders = ['naam', 'afbeelding', 'eetmomenten', 'kooktijd', 'ingredienten', 'allergenen', 'bereiding'];

  const colIndex = {};
  let dataStartIndex;

  if (isHeader) {
    const normalizedHeaders = firstRow.map(h => h.toLowerCase().trim().replace(/ë/g, 'e'));
    expectedHeaders.forEach(expected => {
      const idx = normalizedHeaders.findIndex(h => h.includes(expected));
      colIndex[expected] = idx;
    });
    dataStartIndex = 1;
  } else {
    expectedHeaders.forEach((expected, idx) => {
      colIndex[expected] = idx < firstRow.length ? idx : -1;
    });
    dataStartIndex = 0;
  }

  if (colIndex['naam'] === -1) {
    throw new Error('Kolom "Naam" niet gevonden in het CSV bestand');
  }

  const recipes = [];

  for (let i = dataStartIndex; i < lines.length; i++) {
    const cols = splitCsvRow(lines[i], delimiter);

    const name = getCol(cols, colIndex['naam']);
    if (!name) continue;

    const recipe = {
      name: name,
      image: getCol(cols, colIndex['afbeelding']) || '',
      mealMoments: parseCommaList(getCol(cols, colIndex['eetmomenten'])),
      cookingTime: parseInt(getCol(cols, colIndex['kooktijd'])) || 0,
      ingredients: parseIngredients(getCol(cols, colIndex['ingredienten'])),
      allergens: parseCommaList(getCol(cols, colIndex['allergenen'])),
      preparation: parsePipeList(getCol(cols, colIndex['bereiding'])),
    };

    recipes.push(recipe);
  }

  return recipes;
}

function splitCsvLines(text) {
  const lines = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      lines.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function splitCsvRow(line, delimiter = ';') {
  const cols = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      cols.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  cols.push(current.trim());
  return cols;
}

function getCol(cols, index) {
  if (index === -1 || index === undefined || index >= cols.length) return '';
  return cols[index]?.trim() || '';
}

function parseCommaList(text) {
  if (!text) return [];
  return text.split(',')
    .map(item => item.trim().toLowerCase())
    .filter(item => item !== '');
}

function parsePipeList(text) {
  if (!text) return [];
  return text.split('|')
    .map(item => item.trim())
    .filter(item => item !== '');
}

const KNOWN_UNITS = [
  'gram', 'g', 'kg', 'ml', 'liter', 'l', 'dl', 'cl',
  'eetlepel', 'eetlepels', 'theelepel', 'theelepels',
  'stuk', 'stuks', 'kopje', 'kopjes',
  'snufje', 'scheutje', 'scheut',
  'handvol', 'handje', 'hand',
  'blikje', 'blik', 'blikken',
  'zakje', 'zakjes',
  'plakje', 'plakjes', 'plak',
  'takje', 'takjes',
  'sneetje', 'sneetjes',
  'teen', 'teentje', 'teentjes',
  'druppel', 'druppels',
  'mespunt', 'mespuntje',
];

function parseIngredients(text) {
  if (!text) return [];

  const items = text.split('|').map(item => item.trim()).filter(item => item !== '');

  return items.map(item => {
    const colonIndex = item.indexOf(':');

    if (colonIndex !== -1) {
      const name = item.substring(0, colonIndex).trim();
      const rest = item.substring(colonIndex + 1).trim();

      const amountMatch = rest.match(/^([\d.,/]+)\s*(.*)/);
      if (amountMatch) {
        return {
          name: name,
          amount: amountMatch[1].replace(',', '.'),
          unit: amountMatch[2].trim() || 'stuk'
        };
      }

      return { name: name, amount: '', unit: rest };
    }

    const match = item.match(/^([\d.,/]+)\s+(.*)/);
    if (match) {
      const amount = match[1];
      const rest = match[2].trim();

      const words = rest.split(/\s+/);
      const firstWord = words[0].toLowerCase().replace(/,$/,'');

      if (KNOWN_UNITS.includes(firstWord) && words.length > 1) {
        const unitWord = words[0].replace(/,$/,'');
        const name = words.slice(1).join(' ').replace(/^,\s*/, '');
        return {
          name: name,
          amount: amount.replace(',', '.'),
          unit: unitWord
        };
      }

      return {
        name: rest,
        amount: amount.replace(',', '.'),
        unit: 'stuk'
      };
    }

    return { name: item, amount: '', unit: '' };
  });
}
