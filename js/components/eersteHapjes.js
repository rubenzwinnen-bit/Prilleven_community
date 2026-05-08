/* ============================================
   EERSTE HAPJES TRAJECT
   SPA-pagina (placeholder). Brok A — funderingen.
   Echte feature wordt opgebouwd in volgende
   sessies (onboarding, vandaag-scherm, logging,
   allergenen, symptomen, recept-filter, content).
============================================ */

export function render() {
  return `
    <div class="eh-page">
      <div class="eh-hero">
        <div class="eh-hero-icon">🥄</div>
        <h1 class="eh-hero-title">Eerste Hapjes</h1>
        <p class="eh-hero-sub">Stap voor stap met je kindje door de wereld van vaste voeding.</p>
        <span class="eh-hero-badge">In opbouw</span>
      </div>

      <div class="eh-coming">
        <h2 class="eh-coming-title">Wat eraan komt</h2>
        <ul class="eh-coming-list">
          <li><strong>Vandaag</strong> — een rustig overzicht van waar je staat, met dagsuggesties op maat.</li>
          <li><strong>Loggen zonder druk</strong> — wat je gaf, hoe het ging. Geen cijfers, geen targets.</li>
          <li><strong>Allergenen</strong> — bijhouden wat al gelukt is en wat nog te ontdekken valt.</li>
          <li><strong>"Is dit normaal?"</strong> — geruststellende info bij twijfels over stoelgang, huid of buikje.</li>
          <li><strong>Recepten op maat</strong> — receptenboek filtert op de allergieën van jouw kindje.</li>
          <li><strong>Lezen & leren</strong> — korte stukjes per fase, zoekbaar wanneer je een vraag hebt.</li>
        </ul>
        <p class="eh-coming-note">
          We bouwen dit met zorg. Heb je wensen of feedback? Laat het weten in de community.
        </p>
      </div>
    </div>
  `;
}

export function init() {
  // Nog geen interactie — placeholder.
}
