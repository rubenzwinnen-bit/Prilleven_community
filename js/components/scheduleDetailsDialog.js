/* ============================================
   WEEKSCHEMA GEGEVENS-DIALOOG
   Eén compact formulier voor naam + personen,
   gebruikt bij opslaan en later bewerken.
============================================ */

export function promptScheduleDetails({
  title = 'Weekschema bewaren',
  name = '',
  persons = 4,
  submitLabel = 'Opslaan',
} = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay schedule-editor-overlay';
    overlay.innerHTML = `
      <form class="modal schedule-editor-dialog" role="dialog" aria-modal="true"
            aria-labelledby="schedule-editor-title" novalidate>
        <h2 id="schedule-editor-title"></h2>

        <label class="schedule-editor-field">
          <span>Naam van het weekschema</span>
          <input class="schedule-editor-name" type="text" maxlength="80" autocomplete="off" required>
        </label>

        <label class="schedule-editor-field">
          <span>Aantal personen</span>
          <input class="schedule-editor-persons" type="number" min="1" step="1" inputmode="numeric" required>
        </label>

        <p class="schedule-editor-error" role="alert" aria-live="polite"></p>

        <div class="schedule-editor-actions">
          <button class="btn btn-outline schedule-editor-cancel" type="button">Annuleren</button>
          <button class="btn btn-primary schedule-editor-submit" type="submit"></button>
        </div>
      </form>
    `;

    const form = overlay.querySelector('form');
    const titleElement = overlay.querySelector('#schedule-editor-title');
    const nameInput = overlay.querySelector('.schedule-editor-name');
    const personsInput = overlay.querySelector('.schedule-editor-persons');
    const errorElement = overlay.querySelector('.schedule-editor-error');
    const submitButton = overlay.querySelector('.schedule-editor-submit');

    titleElement.textContent = title;
    submitButton.textContent = submitLabel;
    nameInput.value = name;
    personsInput.value = String(Math.max(1, Number.parseInt(persons, 10) || 4));

    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(value);
    };

    overlay.querySelector('.schedule-editor-cancel').addEventListener('click', () => finish(null));
    overlay.addEventListener('click', event => {
      if (event.target === overlay) finish(null);
    });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') finish(null);
    });

    form.addEventListener('submit', event => {
      event.preventDefault();

      const cleanName = nameInput.value.trim();
      const cleanPersons = Number.parseInt(personsInput.value, 10);

      if (!cleanName) {
        errorElement.textContent = 'Geef het weekschema een naam.';
        nameInput.focus();
        return;
      }
      if (!Number.isInteger(cleanPersons) || cleanPersons < 1) {
        errorElement.textContent = 'Voer een geldig aantal personen in (minimaal 1).';
        personsInput.focus();
        return;
      }

      finish({ name: cleanName, persons: cleanPersons });
    });

    document.body.appendChild(overlay);
    nameInput.focus();
    nameInput.select();
  });
}
