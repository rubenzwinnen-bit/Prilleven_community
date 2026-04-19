# Plan: Email-registratie met betalingsverificatie

## Overzicht
Gebruikers moeten inloggen met hun e-mailadres. Dit wordt gecontroleerd tegen de `allowed_users` tabel in Supabase (gevuld via payment webhook). Niet-betaalde gebruikers worden geweigerd.

---

## Stap 1: `index.html` — Modal aanpassen
- Verander de tekst van "Voer je naam in" naar "Voer je e-mailadres in"
- Input type wijzigen van `text` naar `email`
- Placeholder: "jouw@email.com"
- Foutmelding-element toevoegen onder het inputveld
- Toevoegen van een laad-indicator (spinner/tekst) voor tijdens de verificatie

## Stap 2: `js/supabase.js` — Nieuwe functie `checkAllowedUser(email)`
- Nieuwe export functie die de `allowed_users` tabel bevraagt:
  `GET /rest/v1/allowed_users?email=eq.<email>&select=email`
- Returnt `true` als de email gevonden wordt, `false` als niet
- Gebruikt bestaande `supabaseFetch()` helper

## Stap 3: `script.js` — Login flow met email-verificatie
- Import `checkAllowedUser` uit supabase.js
- `showUserModal()` wordt async:
  1. Gebruiker vult email in
  2. Knop wordt disabled + laad-tekst getoond
  3. `checkAllowedUser(email)` wordt aangeroepen
  4. **Gevonden** → email opslaan via `Store.setCurrentUser(email)`, modal sluiten, `setupApp()`
  5. **Niet gevonden** → foutmelding tonen: "Dit e-mailadres is niet geregistreerd. Neem contact op als je denkt dat dit een fout is."
  6. **Fout (netwerk)** → foutmelding: "Er ging iets mis. Controleer je internetverbinding."
- Email validatie (basis regex) vóór het Supabase-verzoek

## Stap 4: `js/components/header.js` — Email tonen + uitlogknop
- Toon het e-mailadres in de header (i.p.v. de gebruikersnaam)
- Verwijder de "klik om naam te wijzigen" functionaliteit
- Voeg een uitlogknop toe (icoon of tekst "Uitloggen")
- Uitloggen = `localStorage.removeItem('receptenboek_user')` + pagina herladen
- Styling: uitlogknop past bij bestaand design (klein, subtiel)

## Stap 5: `styles.css` — Nieuwe stijlen
- `.login-error` stijl voor foutmeldingen in de modal (rood, klein)
- `.login-loading` stijl voor laad-indicator
- `.btn-logout` stijl voor uitlogknop in header
- `.header-user` aanpassingen voor email + knop layout

## Stap 6: Supabase RLS (handmatige stap)
- De `allowed_users` tabel moet leesbaar zijn voor de anon key
- Controleer of er een RLS policy bestaat die SELECT toestaat
- Zo niet: `CREATE POLICY "allow_anon_read" ON allowed_users FOR SELECT USING (true);`
- SQL migratie bestand toevoegen: `supabase-migrations/2026-04-10-allowed-users-rls.sql`

---

## Bestanden die wijzigen
1. `index.html` — modal HTML
2. `js/supabase.js` — nieuwe `checkAllowedUser()` functie
3. `script.js` — async login flow met verificatie
4. `js/components/header.js` — email weergave + uitlogknop
5. `styles.css` — nieuwe stijlen
6. `supabase-migrations/2026-04-10-allowed-users-rls.sql` — RLS policy

## Wat NIET wijzigt
- `js/store.js` — `getCurrentUser()` en `setCurrentUser()` werken al goed (slaan gewoon een string op, nu een email i.p.v. een naam)
- Alle andere componenten — die gebruiken `Store.getCurrentUser()` en dat geeft nu gewoon het email terug
- De `user_name` kolommen in Supabase — bevatten nu email-adressen (backward compatible, is gewoon tekst)
