/* ============================================
   SUPABASE CLIENT MODULE
   Verbindt de app met Supabase via de REST API.
   Geen npm pakket nodig - puur fetch.

   BELANGRIJK: vervang de waarden hieronder met je
   eigen Supabase URL en anon key.
   Te vinden in: Supabase dashboard > Settings > API
============================================ */

// Supabase project credentials
const SUPABASE_URL = 'https://ynrdoxukevhzupjvcjuw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_iksnuXPtWB_mqunZfLarVQ_tPLWaG02';

/* ----------------------------------------
   SUPABASE FETCH HELPER
   Maakt een HTTP request naar de Supabase REST API
   en voegt automatisch de juiste headers toe.

   path     - bv. '/rest/v1/recipes'
   options  - { method, body, prefer, headers }
---------------------------------------- */
export async function supabaseFetch(path, options = {}) {
  const url = SUPABASE_URL + path;
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    'Prefer': options.prefer || 'return=representation',
    ...options.headers,
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase fout: ${response.status} - ${errorText}`);
  }

  /* Sommige requests (zoals DELETE) geven een lege body terug */
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/* ----------------------------------------
   AFBEELDING UPLOADEN NAAR STORAGE
   Upload een Blob naar de 'recipe-images' bucket
   en geeft de publieke URL terug.

   filePath  - pad binnen de bucket, bv. 'recipes/foto.jpg'
   fileBlob  - de bestandsdata (Blob object)
---------------------------------------- */
export async function supabaseStorageUpload(filePath, fileBlob) {
  const url = `${SUPABASE_URL}/storage/v1/object/recipe-images/${filePath}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': fileBlob.type || 'image/jpeg',
      'x-upsert': 'true',
    },
    body: fileBlob,
  });

  if (!response.ok) {
    throw new Error('Upload van afbeelding mislukt: ' + response.status);
  }

  return supabaseStoragePublicUrl(filePath);
}

/* ----------------------------------------
   PUBLIEKE URL VAN EEN STORAGE BESTAND
---------------------------------------- */
export function supabaseStoragePublicUrl(filePath) {
  return `${SUPABASE_URL}/storage/v1/object/public/recipe-images/${filePath}`;
}

/* ----------------------------------------
   AFBEELDING VERWIJDEREN UIT STORAGE
---------------------------------------- */
export async function supabaseStorageDelete(filePath) {
  await fetch(`${SUPABASE_URL}/storage/v1/object/recipe-images/${filePath}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
    },
  }).catch(() => {});
}

/* ----------------------------------------
   DATA-URI NAAR BLOB CONVERTEREN
   Hulpfunctie om een base64 image om te zetten
   naar een Blob die we kunnen uploaden.
---------------------------------------- */
export function dataUriToBlob(dataUri) {
  const byteString = atob(dataUri.split(',')[1]);
  const mimeString = dataUri.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
}
