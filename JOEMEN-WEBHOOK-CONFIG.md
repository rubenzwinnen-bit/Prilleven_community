# Joemen (GoHighLevel) workflow-configuratie voor subscription-webhooks

Doel: elke subscription-wijziging (nieuw, verlengd, geannuleerd, verlopen) doorsturen naar Pril Leven via één webhook-endpoint, zodat toegangsrechten automatisch worden bijgewerkt in Supabase.

---

## 1. Webhook endpoint

**Basis-URL (productie):**
```
https://jouw-vercel-domain.vercel.app/api/webhooks/plugpay
```

Event-type en billing-cycle worden via URL-query meegegeven — zie onderstaande tabel.

## 2. Vereiste headers

Voor alle webhooks:

| Header | Waarde | Opmerking |
|---|---|---|
| `Content-Type` | `application/json` | altijd |
| `Authorization` | `Bearer <SHARED_SECRET>` | **alleen in productie**, zie sectie 5 |

## 3. Custom data (body)

Per webhook is **alleen email vereist**:

```
email: {{contact.email}}
```

(Andere velden zoals customer_id, end_date zijn optioneel — als Joemen ze kan meegeven, beter. Anders rekenen we een default eind-datum uit.)

## 4. De 4 workflows die je moet instellen

### Workflow 1: Nieuwe aankoop — maandelijks

- **Trigger:** tag "Paid monthly" toegevoegd (of bestaande "Bought link PaP" workflow)
- **Webhook URL:** `https://jouw-vercel-domain.vercel.app/api/webhooks/plugpay?type=activated&cycle=monthly`
- **Body:** `{ "email": "{{contact.email}}" }`

### Workflow 2: Nieuwe aankoop — jaarlijks

- **Trigger:** tag "Paid yearly" toegevoegd
- **Webhook URL:** `https://jouw-vercel-domain.vercel.app/api/webhooks/plugpay?type=activated&cycle=yearly`
- **Body:** `{ "email": "{{contact.email}}" }`

### Workflow 3: Abonnement geannuleerd door klant

- **Trigger:** tag "Cancelled subscription" toegevoegd in Joemen (of Plug&Pay webhook doorgestuurd naar Joemen)
- **Webhook URL:** `https://jouw-vercel-domain.vercel.app/api/webhooks/plugpay?type=cancelled`
- **Body:** `{ "email": "{{contact.email}}" }`
- **Gedrag:** klant houdt toegang tot einde huidige betalingsperiode, `cancelled_at` marker wordt gezet.

### Workflow 4: Abonnement verlopen / betaling mislukt

- **Trigger:** tag "Subscription expired" toegevoegd, OF tag "Paid" verwijderd, OF dunning-flow faalt finaal
- **Webhook URL:** `https://jouw-vercel-domain.vercel.app/api/webhooks/plugpay?type=expired`
- **Body:** `{ "email": "{{contact.email}}" }`
- **Gedrag:** `subscription_active = false`, klant wordt geblokkeerd van de community en chat.

## 5. Security — shared secret (productie)

Om te voorkomen dat iemand met de URL valse cancels kan versturen, zet een shared secret:

**a. Genereer een sterk random secret** (32+ karakters), bv.:
```
openssl rand -hex 32
```

**b. In Vercel Dashboard** → Project Settings → Environment Variables:
- Naam: `PLUGPAY_WEBHOOK_BEARER`
- Waarde: het gegenereerde secret
- Environments: Production + Preview (niet Development als je lokaal test zonder auth)
- Redeploy de app

**c. In Joemen** (elke workflow-webhook) → Headers:
- Voeg header toe: `Authorization` = `Bearer <het-secret>`

Zolang `PLUGPAY_WEBHOOK_BEARER` niet gezet is in Vercel, draait de webhook in trust-mode (alleen veilig voor dev/test).

## 6. Migratie van bestaande workflow

In je huidige "Bought link PaP - CB Community" workflow staat een webhook die direct naar Supabase post (`https://ynrdoxukevhzupjvcjuw.supabase.co/...`).

**Migratie-aanpak (veilig):**

1. **Laat de oude webhook staan** en voeg een nieuwe "Webhook" actie toe aan dezelfde workflow (naast de bestaande).
2. Vul die in met:
   - URL: `https://jouw-vercel-domain.vercel.app/api/webhooks/plugpay?type=activated&cycle=monthly`
   - Body: `email: {{contact.email}}`
   - Header: `Content-Type: application/json` (+ `Authorization` in productie)
3. Test met een proefaankoop of een handmatige workflow-trigger.
4. Controleer in Supabase:
   ```sql
   select email, subscription_active, subscription_end_date, cancelled_at, created_at
   from allowed_users
   where lower(email) = 'test@voorbeeld.be';
   ```
5. Test dat de user kan registreren en inloggen in de community.
6. **Als alles goed werkt** (± 1-2 weken na eerste nieuwe aankoop): verwijder de oude direct-Supabase webhook uit de workflow.

## 7. Troubleshooting

**Webhook-response checken in Joemen:**
- Execution Logs tab in de workflow → zie response per contact.
- Successvolle response: `200 OK` met body `{"received":true,"applied":"activated"}`.
- 401: auth-header klopt niet (check bearer secret).
- 400 "Email missing": `email` ontbreekt in body, of custom data niet goed gemapt.

**Audit-log in Supabase:**
```sql
select email, category, cycle, applied, received_at, error
from subscription_events
order by received_at desc
limit 20;
```
Elke webhook-call wordt hier gelogd — handig om na te gaan wat er gebeurd is en waarom.

**Admin-overzicht:**
Via de Supabase Table Editor kan je `allowed_users` openen en per user zien:
- `subscription_active` (true/false)
- `subscription_end_date` (wanneer loopt huidige periode af)
- `cancelled_at` (null = actief, anders = opgezegd)
- `is_admin` (true = altijd toegang ongeacht subscription)

---

## Samenvatting in één tabel

| Event in Joemen | Query-string | Effect in DB |
|---|---|---|
| Nieuwe aankoop maand | `?type=activated&cycle=monthly` | Insert/update: active=true, end_date=+30d |
| Nieuwe aankoop jaar | `?type=activated&cycle=yearly` | Insert/update: active=true, end_date=+365d |
| Verlenging maand | `?type=activated&cycle=monthly` | Update: active=true, end_date=+30d, cancelled_at=null |
| Verlenging jaar | `?type=activated&cycle=yearly` | Update: active=true, end_date=+365d |
| Cancel | `?type=cancelled` | Update: cancelled_at=nu (toegang blijft tot end_date) |
| Expired / betaling mislukt | `?type=expired` | Update: active=false (direct geen toegang) |
