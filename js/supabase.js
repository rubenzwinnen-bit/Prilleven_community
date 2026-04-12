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
   INGREDIËNT ICOON UPLOADEN NAAR STORAGE
   Upload een Blob naar de 'ingredient-icons' bucket
   en geeft de publieke URL terug.

   filePath  - pad binnen de bucket, bv. 'tomaat.png'
   fileBlob  - de bestandsdata (Blob object)
---------------------------------------- */
export async function uploadIngredientIcon(filePath, fileBlob) {
  const url = `${SUPABASE_URL}/storage/v1/object/ingredient-icons/${filePath}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': fileBlob.type || 'image/png',
      'x-upsert': 'true',
    },
    body: fileBlob,
  });

  if (!response.ok) {
    throw new Error('Upload van icoon mislukt: ' + response.status);
  }

  return ingredientIconPublicUrl(filePath);
}

/* ----------------------------------------
   PUBLIEKE URL VAN EEN INGREDIËNT ICOON
---------------------------------------- */
export function ingredientIconPublicUrl(filePath) {
  return `${SUPABASE_URL}/storage/v1/object/public/ingredient-icons/${filePath}`;
}

/* ----------------------------------------
   INGREDIËNT ICOON VERWIJDEREN UIT STORAGE
---------------------------------------- */
export async function deleteIngredientIcon(filePath) {
  await fetch(`${SUPABASE_URL}/storage/v1/object/ingredient-icons/${filePath}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
    },
  }).catch(() => {});
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
   CONTROLEER OF EEN EMAIL IN DE ALLOWED_USERS TABEL STAAT
   Wordt aangeroepen bij login om te checken of de gebruiker
   betaald heeft via de betalingswebsite.
   Retourneert true als het emailadres gevonden is, anders false.
---------------------------------------- */
export async function checkAllowedUser(email) {
  const data = await supabaseFetch(
    `/rest/v1/allowed_users?email=ilike.${encodeURIComponent(email)}&select=email`
  );
  return Array.isArray(data) && data.length > 0;
}

/* ============================================
   AUTHENTICATIE FUNCTIES (Supabase Auth REST API)
   Gebruikt /auth/v1/ endpoints voor signup, login,
   wachtwoord reset en wachtwoord wijzigen.
============================================ */

/* ----------------------------------------
   AUTH: Controleer of email nog kan registreren
   Email moet in allowed_users staan EN has_registered = false
---------------------------------------- */
export async function checkCanSignUp(email) {
  const data = await supabaseFetch(
    `/rest/v1/allowed_users?email=ilike.${encodeURIComponent(email)}&has_registered=eq.false&select=email`
  );
  return Array.isArray(data) && data.length > 0;
}

/* ----------------------------------------
   AUTH: Maak een Supabase Auth account aan
   POST /auth/v1/signup
---------------------------------------- */
export async function authSignUp(email, password) {
  const url = SUPABASE_URL + '/auth/v1/signup';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.msg || 'Registratie mislukt');
  }
  return data;
}

/* ----------------------------------------
   AUTH: Log in met email en wachtwoord
   POST /auth/v1/token?grant_type=password
---------------------------------------- */
export async function authSignIn(email, password) {
  const url = SUPABASE_URL + '/auth/v1/token?grant_type=password';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.msg || 'Inloggen mislukt');
  }
  return data;
}

/* ----------------------------------------
   AUTH: Stuur een wachtwoord-reset email
   POST /auth/v1/recover
---------------------------------------- */
export async function authResetPassword(email) {
  const url = SUPABASE_URL + '/auth/v1/recover';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error_description || data.msg || 'Verzoek mislukt');
  }
}

/* ----------------------------------------
   AUTH: Stel nieuw wachtwoord in met recovery token
   PUT /auth/v1/user
---------------------------------------- */
export async function authUpdatePassword(accessToken, newPassword) {
  const url = SUPABASE_URL + '/auth/v1/user';
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: newPassword }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.msg || 'Wachtwoord wijzigen mislukt');
  }
  return data;
}

/* ----------------------------------------
   AUTH: Markeer email als geregistreerd in allowed_users
   PATCH /rest/v1/allowed_users (zet has_registered = true)
---------------------------------------- */
export async function markUserRegistered(email) {
  await supabaseFetch(
    `/rest/v1/allowed_users?email=ilike.${encodeURIComponent(email)}`,
    {
      method: 'PATCH',
      body: { has_registered: true },
      prefer: 'return=minimal',
    }
  );
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
