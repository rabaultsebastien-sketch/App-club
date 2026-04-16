/* =========================================================
   Suivi & Projection d'Effectif
   Stockage local (localStorage) — pas de backend requis.
   ========================================================= */

const STORAGE_KEY = 'effectif-app-v1';
const POSITIONS = [
  'Gardien', 'Défenseur central', 'Latéral',
  'Milieu défensif', 'Milieu central', 'Milieu offensif',
  'Ailier', 'Attaquant'
];
const SCOUT_STATUSES = ['À observer', 'Intéressant', 'Priorité', 'Écarté'];

/* ---------- State ---------- */
let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.error('Load error', e); }
  return { squad: [], scouts: [], projection: { kept: [], targets: [], out: [] } };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------- Helpers ---------- */
function totals(matches = []) {
  return matches.reduce((acc, m) => {
    acc.matches += 1;
    acc.minutes += Number(m.minutes) || 0;
    acc.goals += Number(m.goals) || 0;
    acc.assists += Number(m.assists) || 0;
    if (m.starter) acc.starts += 1; else acc.subs += 1;
    return acc;
  }, { matches: 0, minutes: 0, goals: 0, assists: 0, starts: 0, subs: 0 });
}

function statusClass(s) {
  if (!s) return 'status-observe';
  return 'status-' + s.toLowerCase()
    .replace(/à\s+observer/, 'observe')
    .replace(/intéressant/, 'interessant')
    .replace(/priorité/, 'priorite')
    .replace(/écarté/, 'ecarte');
}

function positionOptions(selected) {
  return POSITIONS.map(p =>
    `<option value="${p}"${p === selected ? ' selected' : ''}>${p}</option>`
  ).join('');
}

/* ---------- Tabs ---------- */
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

/* =========================================================
   EFFECTIF ACTUEL
   ========================================================= */
const squadListEl = document.getElementById('squad-list');
const squadSearchEl = document.getElementById('squad-search');
const squadFilterPosEl = document.getElementById('squad-filter-pos');

function renderSquad() {
  const q = squadSearchEl.value.toLowerCase().trim();
  const pos = squadFilterPosEl.value;
  const filtered = state.squad.filter(p => {
    const text = `${p.firstName} ${p.lastName}`.toLowerCase();
    if (q && !text.includes(q)) return false;
    if (pos && p.position !== pos) return false;
    return true;
  });

  if (filtered.length === 0) {
    squadListEl.innerHTML = `<div class="empty">Aucun joueur. Cliquez sur "+ Ajouter un joueur".</div>`;
    return;
  }

  squadListEl.innerHTML = filtered.map(p => {
    const t = totals(p.matches);
    return `
      <div class="card">
        <div class="card-top">
          <div>
            <div class="card-name">${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}
              ${p.number ? `<span class="card-sub">#${p.number}</span>` : ''}
            </div>
            <div class="card-sub">${p.age ? p.age + ' ans · ' : ''}${escapeHtml(p.position || '')}</div>
          </div>
          ${p.position ? `<span class="badge pos">${escapeHtml(p.position)}</span>` : ''}
        </div>
        <div class="stats">
          <div class="stat-box"><div class="n">${t.matches}</div><div class="l">Matchs</div></div>
          <div class="stat-box"><div class="n">${t.minutes}'</div><div class="l">Minutes</div></div>
          <div class="stat-box"><div class="n">${t.goals}</div><div class="l">Buts</div></div>
          <div class="stat-box"><div class="n">${t.assists}</div><div class="l">Passes D</div></div>
        </div>
        <div class="stats" style="grid-template-columns: repeat(2, 1fr);">
          <div class="stat-box"><div class="n">${t.starts}</div><div class="l">Titulaire</div></div>
          <div class="stat-box"><div class="n">${t.subs}</div><div class="l">Remplaçant</div></div>
        </div>
        <div class="card-actions">
          <button class="btn small primary" data-act="match" data-id="${p.id}">+ Match</button>
          <button class="btn small" data-act="view" data-id="${p.id}">Détails</button>
          <button class="btn small" data-act="edit" data-id="${p.id}">Modifier</button>
          <button class="btn small ghost" data-act="del" data-id="${p.id}">Supprimer</button>
        </div>
      </div>
    `;
  }).join('');
}

squadListEl.addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  if (act === 'edit') openPlayerModal(state.squad.find(p => p.id === id));
  else if (act === 'match') openMatchModal(id);
  else if (act === 'view') openPlayerDetails(id);
  else if (act === 'del') {
    if (confirm('Supprimer ce joueur ?')) {
      state.squad = state.squad.filter(p => p.id !== id);
      saveState(); renderSquad(); renderProjection();
    }
  }
});

squadSearchEl.addEventListener('input', renderSquad);
squadFilterPosEl.addEventListener('change', renderSquad);
document.getElementById('add-player-btn').addEventListener('click', () => openPlayerModal());

/* ---------- Player Modal ---------- */
function openPlayerModal(player) {
  const isEdit = !!player;
  const p = player || { firstName: '', lastName: '', age: '', position: '', number: '', notes: '' };
  openModal(`
    <h3>${isEdit ? 'Modifier' : 'Ajouter'} un joueur</h3>
    <form id="player-form">
      <div class="form-row">
        <label>Prénom<input name="firstName" value="${escapeAttr(p.firstName)}" required /></label>
        <label>Nom<input name="lastName" value="${escapeAttr(p.lastName)}" required /></label>
      </div>
      <div class="form-row three">
        <label>Âge<input type="number" name="age" min="14" max="50" value="${escapeAttr(p.age)}" /></label>
        <label>Numéro<input type="number" name="number" min="1" max="99" value="${escapeAttr(p.number)}" /></label>
        <label>Poste<select name="position"><option value="">—</option>${positionOptions(p.position)}</select></label>
      </div>
      <div class="form-row full">
        <label>Notes<textarea name="notes">${escapeHtml(p.notes || '')}</textarea></label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" data-close>Annuler</button>
        <button type="submit" class="btn primary">${isEdit ? 'Enregistrer' : 'Ajouter'}</button>
      </div>
    </form>
  `);
  document.getElementById('player-form').addEventListener('submit', e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    if (isEdit) Object.assign(player, data);
    else state.squad.push({ id: uid(), matches: [], ...data });
    saveState(); closeModal(); renderSquad(); renderProjection();
  });
}

/* ---------- Match Modal ---------- */
function openMatchModal(playerId) {
  const player = state.squad.find(p => p.id === playerId);
  if (!player) return;
  const today = new Date().toISOString().slice(0, 10);
  openModal(`
    <h3>Nouvelle performance — ${escapeHtml(player.firstName)} ${escapeHtml(player.lastName)}</h3>
    <form id="match-form">
      <div class="form-row">
        <label>Date<input type="date" name="date" value="${today}" required /></label>
        <label>Adversaire<input name="opponent" placeholder="Ex: AS Monaco" /></label>
      </div>
      <div class="form-row four">
        <label>Titulaire ?
          <select name="starter">
            <option value="true">Oui</option>
            <option value="false">Non (remplaçant)</option>
          </select>
        </label>
        <label>Minutes<input type="number" name="minutes" min="0" max="120" value="0" required /></label>
        <label>Buts<input type="number" name="goals" min="0" value="0" /></label>
        <label>Passes D<input type="number" name="assists" min="0" value="0" /></label>
      </div>
      <div class="form-row full">
        <label>Note / commentaire<textarea name="notes"></textarea></label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" data-close>Annuler</button>
        <button type="submit" class="btn primary">Enregistrer</button>
      </div>
    </form>
  `);
  document.getElementById('match-form').addEventListener('submit', e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    player.matches = player.matches || [];
    player.matches.push({
      id: uid(),
      date: data.date,
      opponent: data.opponent,
      starter: data.starter === 'true',
      minutes: Number(data.minutes) || 0,
      goals: Number(data.goals) || 0,
      assists: Number(data.assists) || 0,
      notes: data.notes
    });
    saveState(); closeModal(); renderSquad();
  });
}

/* ---------- Player Details ---------- */
function openPlayerDetails(playerId) {
  const p = state.squad.find(x => x.id === playerId);
  if (!p) return;
  const t = totals(p.matches);
  const rows = (p.matches || []).slice().sort((a, b) => b.date.localeCompare(a.date)).map(m => `
    <tr>
      <td>${m.date || ''}</td>
      <td>${escapeHtml(m.opponent || '')}</td>
      <td class="num">${m.starter ? 'Titulaire' : 'Remplaçant'}</td>
      <td class="num">${m.minutes}'</td>
      <td class="num">${m.goals}</td>
      <td class="num">${m.assists}</td>
      <td><button class="btn small ghost" data-del-match="${m.id}">✕</button></td>
    </tr>
  `).join('');
  openModal(`
    <h3>${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</h3>
    <div class="card-sub">${p.age ? p.age + ' ans · ' : ''}${escapeHtml(p.position || '')}${p.number ? ' · #' + p.number : ''}</div>
    <div class="stats" style="margin-top:12px;">
      <div class="stat-box"><div class="n">${t.matches}</div><div class="l">Matchs</div></div>
      <div class="stat-box"><div class="n">${t.starts}</div><div class="l">Titularisations</div></div>
      <div class="stat-box"><div class="n">${t.subs}</div><div class="l">Remplaçant</div></div>
      <div class="stat-box"><div class="n">${t.minutes}'</div><div class="l">Minutes</div></div>
    </div>
    <div class="stats" style="grid-template-columns: repeat(2,1fr); margin-top:8px;">
      <div class="stat-box"><div class="n">${t.goals}</div><div class="l">Buts</div></div>
      <div class="stat-box"><div class="n">${t.assists}</div><div class="l">Passes D</div></div>
    </div>
    <div class="matches-section">
      <h4>Historique des matchs</h4>
      ${rows ? `<table class="matches-table">
        <thead><tr><th>Date</th><th>Adv.</th><th>Rôle</th><th>Min</th><th>B</th><th>PD</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : `<div class="empty">Aucun match enregistré.</div>`}
    </div>
    ${p.notes ? `<div class="matches-section"><h4>Notes</h4><div>${escapeHtml(p.notes)}</div></div>` : ''}
    <div class="modal-actions">
      <button type="button" class="btn" data-close>Fermer</button>
    </div>
  `);
  document.querySelectorAll('[data-del-match]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mid = btn.dataset.delMatch;
      p.matches = p.matches.filter(m => m.id !== mid);
      saveState(); closeModal(); renderSquad(); openPlayerDetails(playerId);
    });
  });
}

/* =========================================================
   RECRUTEMENT
   ========================================================= */
const scoutListEl = document.getElementById('scout-list');
const scoutSearchEl = document.getElementById('scout-search');
const scoutFilterPosEl = document.getElementById('scout-filter-pos');
const scoutFilterStatusEl = document.getElementById('scout-filter-status');

function renderScouts() {
  const q = scoutSearchEl.value.toLowerCase().trim();
  const pos = scoutFilterPosEl.value;
  const status = scoutFilterStatusEl.value;
  const filtered = state.scouts.filter(p => {
    const text = `${p.firstName} ${p.lastName} ${p.club || ''}`.toLowerCase();
    if (q && !text.includes(q)) return false;
    if (pos && p.position !== pos) return false;
    if (status && p.status !== status) return false;
    return true;
  });

  if (filtered.length === 0) {
    scoutListEl.innerHTML = `<div class="empty">Aucun joueur suivi.</div>`;
    return;
  }

  scoutListEl.innerHTML = filtered.map(p => `
    <div class="card">
      <div class="card-top">
        <div>
          <div class="card-name">${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</div>
          <div class="card-sub">
            ${p.age ? p.age + ' ans · ' : ''}${escapeHtml(p.position || '')}
            ${p.club ? ' · ' + escapeHtml(p.club) : ''}
          </div>
        </div>
        ${p.status ? `<span class="badge ${statusClass(p.status)}">${escapeHtml(p.status)}</span>` : ''}
      </div>
      <div class="stats">
        <div class="stat-box"><div class="n">${p.matches || 0}</div><div class="l">Matchs</div></div>
        <div class="stat-box"><div class="n">${p.minutes || 0}'</div><div class="l">Minutes</div></div>
        <div class="stat-box"><div class="n">${p.goals || 0}</div><div class="l">Buts</div></div>
        <div class="stat-box"><div class="n">${p.assists || 0}</div><div class="l">Passes D</div></div>
      </div>
      ${p.notes ? `<div class="card-sub" style="white-space:pre-wrap;">${escapeHtml(p.notes)}</div>` : ''}
      <div class="card-actions">
        <button class="btn small primary" data-act="edit" data-id="${p.id}">Modifier</button>
        <button class="btn small ghost" data-act="del" data-id="${p.id}">Supprimer</button>
      </div>
    </div>
  `).join('');
}

scoutListEl.addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === 'edit') openScoutModal(state.scouts.find(p => p.id === id));
  else if (btn.dataset.act === 'del') {
    if (confirm('Supprimer ce joueur suivi ?')) {
      state.scouts = state.scouts.filter(p => p.id !== id);
      saveState(); renderScouts(); renderProjection();
    }
  }
});

[scoutSearchEl, scoutFilterPosEl, scoutFilterStatusEl].forEach(el =>
  el.addEventListener('input', renderScouts)
);
document.getElementById('add-scout-btn').addEventListener('click', () => openScoutModal());

function openScoutModal(player) {
  const isEdit = !!player;
  const p = player || {
    firstName: '', lastName: '', age: '', position: '', club: '',
    matches: '', minutes: '', goals: '', assists: '', status: 'À observer', notes: ''
  };
  openModal(`
    <h3>${isEdit ? 'Modifier' : 'Ajouter'} un joueur suivi</h3>
    <form id="scout-form">
      <div class="form-row">
        <label>Prénom<input name="firstName" value="${escapeAttr(p.firstName)}" required /></label>
        <label>Nom<input name="lastName" value="${escapeAttr(p.lastName)}" required /></label>
      </div>
      <div class="form-row three">
        <label>Âge<input type="number" name="age" min="14" max="50" value="${escapeAttr(p.age)}" /></label>
        <label>Poste<select name="position"><option value="">—</option>${positionOptions(p.position)}</select></label>
        <label>Statut<select name="status">${SCOUT_STATUSES.map(s => `<option${s === p.status ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
      </div>
      <div class="form-row full">
        <label>Club actuel<input name="club" value="${escapeAttr(p.club)}" /></label>
      </div>
      <div class="form-row four">
        <label>Matchs<input type="number" name="matches" min="0" value="${escapeAttr(p.matches)}" /></label>
        <label>Minutes<input type="number" name="minutes" min="0" value="${escapeAttr(p.minutes)}" /></label>
        <label>Buts<input type="number" name="goals" min="0" value="${escapeAttr(p.goals)}" /></label>
        <label>Passes D<input type="number" name="assists" min="0" value="${escapeAttr(p.assists)}" /></label>
      </div>
      <div class="form-row full">
        <label>Notes d'observation<textarea name="notes">${escapeHtml(p.notes || '')}</textarea></label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" data-close>Annuler</button>
        <button type="submit" class="btn primary">${isEdit ? 'Enregistrer' : 'Ajouter'}</button>
      </div>
    </form>
  `);
  document.getElementById('scout-form').addEventListener('submit', e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    ['age', 'matches', 'minutes', 'goals', 'assists'].forEach(k => {
      data[k] = data[k] === '' ? '' : Number(data[k]);
    });
    if (isEdit) Object.assign(player, data);
    else state.scouts.push({ id: uid(), ...data });
    saveState(); closeModal(); renderScouts(); renderProjection();
  });
}

/* =========================================================
   PROJECTION N+1
   ========================================================= */
function renderProjection() {
  // Nettoie les références supprimées
  state.projection.kept = state.projection.kept.filter(id => state.squad.some(p => p.id === id));
  state.projection.out = state.projection.out.filter(id => state.squad.some(p => p.id === id));
  state.projection.targets = state.projection.targets.filter(id => state.scouts.some(p => p.id === id));

  const keptEl = document.getElementById('proj-kept');
  const outEl = document.getElementById('proj-out');
  const targetsEl = document.getElementById('proj-targets');
  const summaryEl = document.getElementById('projection-summary');

  const renderItem = (name, meta, onMove, onRemove, moveLabel) => `
    <div class="proj-item">
      <div>
        <div class="name">${escapeHtml(name)}</div>
        <div class="meta">${escapeHtml(meta)}</div>
      </div>
      <div style="display:flex; gap:4px;">
        ${onMove ? `<button class="btn small" data-move="${onMove}">${moveLabel}</button>` : ''}
        <button class="btn small ghost" data-remove="${onRemove}">✕</button>
      </div>
    </div>
  `;

  keptEl.innerHTML = state.projection.kept.length
    ? state.projection.kept.map(id => {
        const p = state.squad.find(x => x.id === id);
        return renderItem(`${p.firstName} ${p.lastName}`, p.position || '', `kept-to-out:${id}`, `kept:${id}`, '→ Départ');
      }).join('')
    : `<div class="empty" style="padding:16px;">Aucun joueur conservé</div>`;

  outEl.innerHTML = state.projection.out.length
    ? state.projection.out.map(id => {
        const p = state.squad.find(x => x.id === id);
        return renderItem(`${p.firstName} ${p.lastName}`, p.position || '', `out-to-kept:${id}`, `out:${id}`, '→ Conserver');
      }).join('')
    : `<div class="empty" style="padding:16px;">Aucun départ</div>`;

  targetsEl.innerHTML = state.projection.targets.length
    ? state.projection.targets.map(id => {
        const p = state.scouts.find(x => x.id === id);
        return renderItem(
          `${p.firstName} ${p.lastName}`,
          `${p.position || ''}${p.club ? ' · ' + p.club : ''}`,
          null, `target:${id}`, ''
        );
      }).join('')
    : `<div class="empty" style="padding:16px;">Aucune cible</div>`;

  summaryEl.innerHTML = `
    <div class="summary-item"><div class="n">${state.projection.kept.length}</div><div class="l">Conservés</div></div>
    <div class="summary-item"><div class="n">${state.projection.targets.length}</div><div class="l">Cibles</div></div>
    <div class="summary-item"><div class="n">${state.projection.out.length}</div><div class="l">Départs</div></div>
    <div class="summary-item"><div class="n">${state.projection.kept.length + state.projection.targets.length}</div><div class="l">Total N+1</div></div>
  `;

  saveState();
}

document.getElementById('projection').addEventListener('click', e => {
  const moveBtn = e.target.closest('[data-move]');
  const removeBtn = e.target.closest('[data-remove]');
  if (moveBtn) {
    const [action, id] = moveBtn.dataset.move.split(':');
    if (action === 'kept-to-out') {
      state.projection.kept = state.projection.kept.filter(x => x !== id);
      if (!state.projection.out.includes(id)) state.projection.out.push(id);
    } else if (action === 'out-to-kept') {
      state.projection.out = state.projection.out.filter(x => x !== id);
      if (!state.projection.kept.includes(id)) state.projection.kept.push(id);
    }
    renderProjection();
  } else if (removeBtn) {
    const [group, id] = removeBtn.dataset.remove.split(':');
    state.projection[group] = state.projection[group].filter(x => x !== id);
    renderProjection();
  }
});

document.getElementById('proj-pick-current').addEventListener('click', () => {
  const already = new Set([...state.projection.kept, ...state.projection.out]);
  const available = state.squad.filter(p => !already.has(p.id));
  openPickerModal('Choisir depuis l\'effectif actuel', available.map(p => ({
    id: p.id, label: `${p.firstName} ${p.lastName}`, sub: p.position || ''
  })), (selectedIds, dest) => {
    selectedIds.forEach(id => {
      if (dest === 'kept' && !state.projection.kept.includes(id)) state.projection.kept.push(id);
      if (dest === 'out' && !state.projection.out.includes(id)) state.projection.out.push(id);
    });
    renderProjection();
  }, ['kept', 'out'], { kept: 'Conserver', out: 'Départ' });
});

document.getElementById('proj-pick-scout').addEventListener('click', () => {
  const already = new Set(state.projection.targets);
  const available = state.scouts.filter(p => !already.has(p.id));
  openPickerModal('Choisir depuis les joueurs suivis', available.map(p => ({
    id: p.id, label: `${p.firstName} ${p.lastName}`, sub: `${p.position || ''}${p.club ? ' · ' + p.club : ''}`
  })), (selectedIds) => {
    selectedIds.forEach(id => {
      if (!state.projection.targets.includes(id)) state.projection.targets.push(id);
    });
    renderProjection();
  }, ['targets'], { targets: 'Ajouter en cible' });
});

function openPickerModal(title, items, onConfirm, destinations, labels) {
  if (items.length === 0) {
    openModal(`
      <h3>${title}</h3>
      <div class="empty">Aucun joueur disponible.</div>
      <div class="modal-actions"><button class="btn" data-close>Fermer</button></div>
    `);
    return;
  }
  const selected = new Set();
  openModal(`
    <h3>${title}</h3>
    <div class="hint">Sélectionnez un ou plusieurs joueurs.</div>
    <div class="picker-list">
      ${items.map(i => `
        <div class="picker-item" data-id="${i.id}">
          <div>
            <div>${escapeHtml(i.label)}</div>
            <div class="card-sub">${escapeHtml(i.sub)}</div>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn" data-close>Annuler</button>
      ${destinations.map(d => `<button class="btn primary" data-dest="${d}">${labels[d]}</button>`).join('')}
    </div>
  `);
  document.querySelectorAll('.picker-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      if (selected.has(id)) { selected.delete(id); el.classList.remove('selected'); }
      else { selected.add(id); el.classList.add('selected'); }
    });
  });
  document.querySelectorAll('[data-dest]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (selected.size === 0) { alert('Sélectionnez au moins un joueur.'); return; }
      onConfirm([...selected], btn.dataset.dest);
      closeModal();
    });
  });
}

/* =========================================================
   DONNEES : Export / Import / Reset
   ========================================================= */
document.getElementById('export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `effectif-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.squad || !data.scouts) throw new Error('Format invalide');
    if (!data.projection) data.projection = { kept: [], targets: [], out: [] };
    if (!confirm('Remplacer les données actuelles par le contenu du fichier ?')) return;
    state = data;
    saveState(); renderAll();
    alert('Import réussi.');
  } catch (err) {
    alert('Erreur à l\'import : ' + err.message);
  }
  e.target.value = '';
});

document.getElementById('reset-btn').addEventListener('click', () => {
  if (!confirm('Tout effacer ? Cette action est irréversible.')) return;
  state = { squad: [], scouts: [], projection: { kept: [], targets: [], out: [] } };
  saveState(); renderAll();
});

/* =========================================================
   IMPORT FDMI (feuille de match Footclubs)
   ========================================================= */
document.getElementById('import-fdmi').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const fdmi = JSON.parse(text);
    if (!fdmi.players || !Array.isArray(fdmi.players)) {
      throw new Error('Ce fichier ne contient pas de liste de joueurs (clé "players").');
    }
    openFdmiPreviewModal(fdmi);
  } catch (err) {
    alert('Erreur à la lecture du fichier : ' + err.message);
  }
  e.target.value = '';
});

/* ---------- Import FDMI PDF ---------- */
document.getElementById('import-fdmi-pdf').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  if (!window.pdfjsLib) {
    alert('PDF.js n\'est pas chargé. Vérifiez votre connexion internet.');
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Groupe les items par ligne (même coordonnée Y, à 2 pixels près)
      const lines = {};
      content.items.forEach(it => {
        const y = Math.round(it.transform[5]);
        const key = Math.floor(y / 3) * 3; // bucket 3px pour tolérer petites variations
        if (!lines[key]) lines[key] = [];
        lines[key].push({ x: it.transform[4], text: it.str });
      });
      const sorted = Object.keys(lines).map(Number).sort((a, b) => b - a);
      const pageLines = sorted.map(y =>
        lines[y].sort((a, b) => a.x - b.x).map(i => i.text).join(' ').replace(/\s+/g, ' ').trim()
      ).filter(Boolean);
      pages.push(pageLines);
    }
    const allLines = pages.flat();
    const parsed = tryParseFdmiPdf(allLines);
    openPdfFdmiModal(allLines, parsed);
  } catch (err) {
    console.error(err);
    alert('Erreur à la lecture du PDF : ' + err.message);
  }
  e.target.value = '';
});

/* Tente d'extraire la FDMI depuis les lignes de texte du PDF.
   Les FDMI FFF suivent un format récurrent qu'on va affiner après
   avoir vu le texte réel. Pour la v1 on retourne null et on affiche
   le texte brut pour copie/inspection. */
function tryParseFdmiPdf(lines) {
  const joined = lines.join('\n');

  // Cherche une date au format JJ/MM/AAAA ou AAAA-MM-JJ
  const dateMatch = joined.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  const date = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : '';

  // Patterns possibles pour une ligne joueur :
  //  "9 EL KHOUMISTI Fahd 90"           (numéro NOM Prénom minutes)
  //  "9 Fahd EL KHOUMISTI"               (numéro Prénom NOM)
  //  "9 EL KHOUMISTI F."                 (initiale)
  const playerLineRe = /^(\d{1,2})\s+([A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ\s'\-]+?)\s+([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ\-']+(?:\s+[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ\-']+)*)\s*(\d{1,3})?$/;
  const playerLineAltRe = /^(\d{1,2})\s+([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ\-']+(?:\s+[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ\-']+)*)\s+([A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ\s'\-]+?)\s*(\d{1,3})?$/;

  const players = [];
  lines.forEach(line => {
    const m = line.match(playerLineRe) || line.match(playerLineAltRe);
    if (!m) return;
    const [, number, a, b, min] = m;
    // Détermine qui est le nom (tout majuscules) et qui est le prénom
    const aIsUpper = a === a.toUpperCase();
    const lastName = aIsUpper ? a.trim() : b.trim();
    const firstName = aIsUpper ? b.trim() : a.trim();
    if (players.some(p => p.number === number)) return; // dédup
    players.push({
      number,
      firstName,
      lastName,
      starter: null,
      minutes: min ? Number(min) : null,
      goals: 0,
      assists: 0
    });
  });

  if (players.length < 3) return null; // pas assez pour considérer que c'est fiable

  return { match: { date, opponent: '', competition: '' }, players };
}

function openPdfFdmiModal(rawLines, parsed) {
  const sample = rawLines.slice(0, 200).join('\n');
  const playersHtml = parsed && parsed.players.length
    ? `<div class="hint" style="margin-top:8px;">${parsed.players.length} joueurs détectés automatiquement.</div>`
    : `<div class="hint" style="margin-top:8px; color:var(--warning);">Aucun joueur détecté. Copiez le texte brut ci-dessous et envoyez-le à votre assistant pour adapter le parseur.</div>`;

  openModal(`
    <h3>Import FDMI PDF</h3>
    ${playersHtml}
    ${parsed ? renderParsedPreview(parsed) : ''}
    <div class="matches-section">
      <h4>Texte brut extrait du PDF (${rawLines.length} lignes)</h4>
      <textarea readonly style="width:100%; height:240px; font-family:monospace; font-size:11px; background:var(--bg-card); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:8px;">${escapeHtml(sample)}</textarea>
      <button class="btn small" id="copy-raw" style="margin-top:6px;">📋 Copier le texte brut</button>
    </div>
    <div class="modal-actions">
      <button class="btn" data-close>Fermer</button>
      ${parsed ? `<button class="btn primary" id="confirm-pdf-import">Continuer vers l'appariement</button>` : ''}
    </div>
  `);

  document.getElementById('copy-raw').addEventListener('click', () => {
    const ta = document.querySelector('.modal textarea');
    ta.select();
    navigator.clipboard.writeText(rawLines.join('\n'));
    alert('Texte copié dans le presse-papier.');
  });

  if (parsed) {
    document.getElementById('confirm-pdf-import').addEventListener('click', () => {
      closeModal();
      openFdmiPreviewModal(parsed);
    });
  }
}

function renderParsedPreview(parsed) {
  return `
    <div class="matches-section">
      <h4>Aperçu des joueurs détectés</h4>
      <table class="matches-table">
        <thead><tr><th>#</th><th>Prénom</th><th>Nom</th><th class="num">Min</th></tr></thead>
        <tbody>
          ${parsed.players.map(p => `
            <tr>
              <td>${escapeHtml(p.number)}</td>
              <td>${escapeHtml(p.firstName)}</td>
              <td>${escapeHtml(p.lastName)}</td>
              <td class="num">${p.minutes ?? '?'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function normalizeName(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function matchSquadPlayer(fdmiPlayer) {
  const num = fdmiPlayer.number ? String(fdmiPlayer.number) : '';
  if (num) {
    const byNum = state.squad.find(p => String(p.number) === num);
    if (byNum) return byNum;
  }
  const fln = normalizeName(fdmiPlayer.lastName);
  const ffn = normalizeName(fdmiPlayer.firstName);
  return state.squad.find(p =>
    normalizeName(p.lastName) === fln && normalizeName(p.firstName) === ffn
  ) || state.squad.find(p => normalizeName(p.lastName) === fln);
}

function openFdmiPreviewModal(fdmi) {
  const matchInfo = fdmi.match || {};
  const rows = fdmi.players.map((fp, i) => {
    const squadP = matchSquadPlayer(fp);
    return { fp, squadP, index: i, include: !!squadP && (fp.minutes > 0 || fp.starter) };
  });

  const matched = rows.filter(r => r.squadP).length;
  const unmatched = rows.filter(r => !r.squadP);

  openModal(`
    <h3>Aperçu FDMI</h3>
    <div class="card-sub" style="margin-bottom:10px;">
      ${matchInfo.date ? '📅 ' + escapeHtml(matchInfo.date) : ''}
      ${matchInfo.opponent ? ' · vs ' + escapeHtml(matchInfo.opponent) : ''}
      ${matchInfo.competition ? ' · ' + escapeHtml(matchInfo.competition) : ''}
    </div>
    <div class="hint" style="margin-bottom:10px;">
      ${matched} / ${rows.length} joueurs appariés avec votre effectif.
      ${unmatched.length > 0 ? ` <span style="color:var(--warning)">${unmatched.length} non reconnu(s).</span>` : ''}
    </div>
    <div class="form-row" style="margin-bottom:10px;">
      <label>Date du match<input type="date" id="fdmi-date" value="${escapeAttr(matchInfo.date || new Date().toISOString().slice(0,10))}" /></label>
      <label>Adversaire<input id="fdmi-opponent" value="${escapeAttr(matchInfo.opponent || '')}" /></label>
    </div>
    <table class="matches-table" style="margin-top:10px;">
      <thead>
        <tr>
          <th style="width:30px;">✓</th>
          <th>Joueur FDMI</th>
          <th>Apparié avec</th>
          <th class="num">T/R</th>
          <th class="num">Min</th>
          <th class="num">B</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr style="${r.squadP ? '' : 'opacity:0.5;'}">
            <td><input type="checkbox" data-i="${r.index}" ${r.include ? 'checked' : ''} ${r.squadP ? '' : 'disabled'}></td>
            <td>${r.fp.number ? '#' + escapeHtml(r.fp.number) + ' ' : ''}${escapeHtml(r.fp.firstName)} ${escapeHtml(r.fp.lastName)}</td>
            <td>${r.squadP ? escapeHtml(r.squadP.firstName + ' ' + r.squadP.lastName) : '<em>non trouvé</em>'}</td>
            <td class="num">${r.fp.starter ? 'T' : 'R'}</td>
            <td class="num">${r.fp.minutes || 0}'</td>
            <td class="num">${r.fp.goals || 0}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="modal-actions">
      <button class="btn" data-close>Annuler</button>
      <button class="btn primary" id="fdmi-confirm">Importer dans l'effectif</button>
    </div>
  `);

  document.getElementById('fdmi-confirm').addEventListener('click', () => {
    const date = document.getElementById('fdmi-date').value;
    const opponent = document.getElementById('fdmi-opponent').value;
    const included = new Set(
      [...document.querySelectorAll('input[type="checkbox"][data-i]:checked')]
        .map(cb => Number(cb.dataset.i))
    );
    let added = 0;
    rows.forEach(r => {
      if (!included.has(r.index) || !r.squadP) return;
      r.squadP.matches = r.squadP.matches || [];
      r.squadP.matches.push({
        id: uid(),
        date,
        opponent,
        starter: !!r.fp.starter,
        minutes: Number(r.fp.minutes) || 0,
        goals: Number(r.fp.goals) || 0,
        assists: Number(r.fp.assists) || 0,
        notes: 'Import FDMI'
      });
      added++;
    });
    saveState(); closeModal(); renderSquad();
    alert(`✅ ${added} performance(s) ajoutée(s).`);
  });
}

/* =========================================================
   MODAL infrastructure
   ========================================================= */
function openModal(html) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
  root.querySelector('.modal-backdrop').addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) closeModal();
  });
  root.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModal));
}
function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

/* =========================================================
   Utils
   ========================================================= */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

/* =========================================================
   Init
   ========================================================= */
function renderAll() {
  renderSquad();
  renderScouts();
  renderProjection();
}
renderAll();
