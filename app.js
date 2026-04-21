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
    const mins = Number(m.minutes) || 0;
    acc.minutes += mins;
    acc.goals += Number(m.goals) || 0;
    acc.assists += Number(m.assists) || 0;
    acc.yellowCards += Number(m.yellowCards) || 0;
    acc.redCards += Number(m.redCards) || 0;
    // Un titulaire compte toujours ; un remplaçant compte uniquement s'il est entré en jeu (min > 0).
    if (m.starter) { acc.starts += 1; acc.matches += 1; }
    else if (mins > 0) { acc.subs += 1; acc.matches += 1; }
    return acc;
  }, { matches: 0, minutes: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, starts: 0, subs: 0 });
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
          <div class="stat-box"><div class="n">${t.starts}</div><div class="l">Titulaire</div></div>
          <div class="stat-box"><div class="n">${t.subs}</div><div class="l">Remplaçant</div></div>
        </div>
        <div class="stats">
          <div class="stat-box"><div class="n">${t.goals}</div><div class="l">Buts</div></div>
          <div class="stat-box"><div class="n">${t.assists}</div><div class="l">Passes D</div></div>
          <div class="stat-box"><div class="n">${t.yellowCards}</div><div class="l">🟨 Jaunes</div></div>
          <div class="stat-box"><div class="n">${t.redCards}</div><div class="l">🟥 Rouges</div></div>
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
      <div class="form-row">
        <label>🟨 Cartons jaunes<input type="number" name="yellowCards" min="0" max="2" value="0" /></label>
        <label>🟥 Cartons rouges<input type="number" name="redCards" min="0" max="1" value="0" /></label>
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
      yellowCards: Number(data.yellowCards) || 0,
      redCards: Number(data.redCards) || 0,
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
  const rows = (p.matches || []).slice().sort((a, b) => b.date.localeCompare(a.date)).map(m => {
    const sh = Number(m.scoreHome), sa = Number(m.scoreAway);
    let resultText = '', resultClass = '';
    if (!isNaN(sh) && !isNaN(sa)) {
      if (sh > sa) { resultText = `${sh} - ${sa} (V)`; resultClass = 'result-win'; }
      else if (sh < sa) { resultText = `${sh} - ${sa} (D)`; resultClass = 'result-loss'; }
      else { resultText = `${sh} - ${sa} (N)`; resultClass = 'result-draw'; }
    }
    return `<tr>
      <td>${m.date || ''}</td>
      <td>${escapeHtml(m.round || '')}</td>
      <td>${escapeHtml(m.opponent || '')}</td>
      <td class="num ${resultClass}">${resultText}</td>
      <td class="num">${m.starter ? 'Titu' : 'Rempl'}</td>
      <td class="num">${m.minutes}'</td>
      <td class="num">${m.goals}</td>
      <td class="num">${m.assists}</td>
      <td class="num">${m.yellowCards || 0}</td>
      <td class="num">${m.redCards || 0}</td>
      <td><button class="btn small ghost" data-del-match="${m.id}">✕</button></td>
    </tr>`;
  }).join('');
  openModal(`
    <h3>${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</h3>
    <div class="card-sub">${p.age ? p.age + ' ans · ' : ''}${escapeHtml(p.position || '')}${p.number ? ' · #' + p.number : ''}</div>
    <div class="stats" style="margin-top:12px;">
      <div class="stat-box"><div class="n">${t.matches}</div><div class="l">Matchs</div></div>
      <div class="stat-box"><div class="n">${t.starts}</div><div class="l">Titularisations</div></div>
      <div class="stat-box"><div class="n">${t.subs}</div><div class="l">Remplaçant</div></div>
      <div class="stat-box"><div class="n">${t.minutes}'</div><div class="l">Minutes</div></div>
    </div>
    <div class="stats" style="grid-template-columns: repeat(4,1fr); margin-top:8px;">
      <div class="stat-box"><div class="n">${t.goals}</div><div class="l">Buts</div></div>
      <div class="stat-box"><div class="n">${t.assists}</div><div class="l">Passes D</div></div>
      <div class="stat-box"><div class="n">${t.yellowCards}</div><div class="l">🟨 Jaunes</div></div>
      <div class="stat-box"><div class="n">${t.redCards}</div><div class="l">🟥 Rouges</div></div>
    </div>
    <div class="matches-section">
      <h4>Historique des matchs</h4>
      ${rows ? `<table class="matches-table">
        <thead><tr><th>Date</th><th>Journée</th><th>Adversaire</th><th>Résultat</th><th>Rôle</th><th>Min</th><th>B</th><th>PD</th><th>🟨</th><th>🟥</th><th></th></tr></thead>
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
document.getElementById('import-fdmi')?.addEventListener('change', async e => {
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
document.getElementById('import-fdmi-pdf')?.addEventListener('change', async e => {
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
      const viewport = page.getViewport({ scale: 1 });
      const midX = viewport.width / 2;
      const content = await page.getTextContent();

      // Groupe les items texte par ligne (même Y, bucket 3px)
      const buckets = {};
      content.items.forEach(it => {
        const y = Math.round(it.transform[5]);
        const key = Math.floor(y / 3) * 3;
        if (!buckets[key]) buckets[key] = [];
        buckets[key].push({ x: it.transform[4], text: it.str });
      });

      // Détecte les rectangles colorés (cartons jaune/rouge) via les opérateurs PDF
      const cardRects = [];
      try {
        const opList = await page.getOperatorList();
        const OPS = pdfjsLib.OPS;
        let curR = 0, curG = 0, curB = 0;
        for (let j = 0; j < opList.fnArray.length; j++) {
          const fn = opList.fnArray[j];
          const args = opList.argsArray[j];
          if (fn === OPS.setFillRGBColor) {
            [curR, curG, curB] = args;
          } else if (fn === OPS.setFillGray) {
            curR = curG = curB = args[0];
          } else if (fn === OPS.rectangle) {
            const [rx, ry, rw, rh] = args;
            const w = Math.abs(rw), h = Math.abs(rh);
            // Petit rectangle (carton ≈ 8-30 unités PDF)
            if (w >= 4 && w <= 40 && h >= 4 && h <= 35) {
              const isYellow = curR > 0.7 && curG > 0.5 && curB < 0.3;
              const isRed    = curR > 0.6 && curG < 0.3 && curB < 0.3;
              if (isYellow || isRed) {
                cardRects.push({ y: Math.round(ry), isYellow, isRed });
              }
            }
          }
        }
      } catch (_) { /* opérateurs non disponibles : ignoré */ }

      const sorted = Object.keys(buckets).map(Number).sort((a, b) => b - a);
      const pageRows = sorted.map(yKey => {
        const items = buckets[yKey].sort((a, b) => a.x - b.x);
        const text = items.map(i => i.text).join(' ').replace(/\s+/g, ' ').trim();
        const leftText  = items.filter(i => i.x < midX).map(i => i.text).join(' ').replace(/\s+/g, ' ').trim();
        const rightText = items.filter(i => i.x >= midX).map(i => i.text).join(' ').replace(/\s+/g, ' ').trim();
        // Associe le carton le plus proche par Y (±15 unités PDF)
        const nearby = cardRects.filter(cr => Math.abs(cr.y - yKey) <= 15);
        const yellowCard = nearby.some(cr => cr.isYellow);
        const redCard    = nearby.some(cr => cr.isRed);
        return { text, leftText, rightText, rawY: yKey, yellowCard, redCard };
      }).filter(r => r.text);
      pages.push(pageRows);
    }
    const allRows = pages.flat();
    const parsed = tryParseFdmiPdf(allRows);
    openPdfFdmiModal(allRows.map(r => r.text), parsed);
  } catch (err) {
    console.error(err);
    alert('Erreur à la lecture du PDF : ' + err.message);
  }
  e.target.value = '';
});

/* Parseur FDMI FFF — format réel observé.
   Structure clé :
     - COMPOSITION : titulaires (deux colonnes, séparées par le n° de licence)
     - REMPLAÇANTS : suppléants, avec marqueur "N'a pas participé"
     - REMPLACEMENT : événements de substitution (minute d'entrée/sortie)
     - BUTEURS : buts + passeurs (= passes décisives)
     - DISCIPLINE : cartons
   Chaque ligne texte contient à la fois l'info domicile ET extérieur,
   séparées par les numéros de licence (9 ou 10 chiffres).
*/
function tryParseFdmiPdf(input) {
  // Accepte soit un tableau de chaînes (compat tests), soit un tableau de {text, leftText, rightText}
  const rows = input.map(r => typeof r === 'string'
    ? { text: r, leftText: '', rightText: '' }
    : r);
  const lines = rows.map(r => r.text);

  const sections = findFdmiSections(lines);
  if (!sections.COMPOSITION) return null;

  const text = lines.join('\n');

  // Méta du match
  const dateMatch = text.match(/Date\s*:\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2})h(\d{2})/);
  const date = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : '';
  const competitionMatch = text.match(/Compétition\s*:\s*(.+?)(?:\s+Arrêté|\n|$)/);
  const competition = competitionMatch ? competitionMatch[1].trim() : '';

  // Noms des équipes (ligne juste après "Equipe Recevante Equipe Visiteuse")
  let homeTeamName = '', awayTeamName = '';
  const teamLineIdx = sections.COMPOSITION + 2;
  if (lines[teamLineIdx]) {
    const teamLine = lines[teamLineIdx];
    // Exemple: "Orleans Us 45 1 - 504891 Concarneau Us 1 - 500308"
    const parts = teamLine.split(/\s+-\s+\d{5,7}/);
    if (parts.length >= 2) {
      homeTeamName = parts[0].replace(/\s+\d+$/, '').trim(); // retire le score
      awayTeamName = parts[1].replace(/\s+\d+$/, '').trim();
    }
  }

  // Titulaires
  const players = [];
  const compStart = sections.COMPOSITION + 3;
  const compEnd = sections.REMPLACANTS || lines.length;
  for (let i = compStart; i < compEnd; i++) {
    const parsed = parseDoubleColumnLine(lines[i]);
    if (parsed) {
      if (parsed.home) players.push({ ...parsed.home, starter: true, team: 'home', didNotPlay: false });
      if (parsed.away) players.push({ ...parsed.away, starter: true, team: 'away', didNotPlay: false });
    }
  }

  // Remplaçants
  if (sections.REMPLACANTS != null) {
    const subEnd = sections.BANC || sections.REMPLACEMENT || lines.length;
    for (let i = sections.REMPLACANTS + 1; i < subEnd; i++) {
      const parsed = parseDoubleColumnLine(lines[i], { detectNotPlayed: true });
      if (parsed) {
        if (parsed.home) players.push({ ...parsed.home, starter: false, team: 'home' });
        if (parsed.away) players.push({ ...parsed.away, starter: false, team: 'away' });
      }
    }
  }

  // Buts + passes décisives
  if (sections.BUTEURS != null) {
    const butEnd = findNextSection(lines, sections.BUTEURS + 1);
    for (let i = sections.BUTEURS + 2; i < butEnd; i++) {
      const g = parseGoalLine(lines[i]);
      if (!g) continue;
      const scorer = players.find(p =>
        normalizeName(p.lastName).includes(normalizeName(g.scorerLast)) &&
        String(p.number) === String(g.scorerNumber)
      );
      if (scorer) scorer.goals = (scorer.goals || 0) + 1;
      if (g.assistNumber) {
        const assister = players.find(p =>
          normalizeName(p.lastName).includes(normalizeName(g.assistLast)) &&
          String(p.number) === String(g.assistNumber)
        );
        if (assister) assister.assists = (assister.assists || 0) + 1;
      }
    }
  }

  // Minutes : défauts (titulaire=90, sub=0, non entré=0). Seront affinées par REMPLACEMENT.
  players.forEach(p => {
    p.minutes = p.didNotPlay ? 0 : (p.starter ? 90 : 0);
    p.goals = p.goals || 0;
    p.assists = p.assists || 0;
    p.yellowCards = 0;
    p.redCards = 0;
  });

  // Remplacements : calcule les minutes réelles (titulaire sorti / sub entré).
  const diagnostic = { sections, remplacementRows: [], disciplineRows: [] };
  if (sections.REMPLACEMENT != null) {
    const remEnd = findNextSection(lines, sections.REMPLACEMENT + 1);
    for (let i = sections.REMPLACEMENT + 1; i < remEnd; i++) {
      if (rows[i]) diagnostic.remplacementRows.push({
        text: rows[i].text, left: rows[i].leftText, right: rows[i].rightText
      });
    }
    parseRemplacementRows(rows, sections.REMPLACEMENT + 1, remEnd, players);
  }

  // Discipline : cartons jaunes / rouges.
  if (sections.DISCIPLINE != null) {
    const dispEnd = findNextSection(lines, sections.DISCIPLINE + 1);
    for (let i = sections.DISCIPLINE + 1; i < dispEnd; i++) {
      if (rows[i]) diagnostic.disciplineRows.push({
        text: rows[i].text, left: rows[i].leftText, right: rows[i].rightText,
        yellowCard: rows[i].yellowCard, redCard: rows[i].redCard
      });
    }
    parseDisciplineRows(rows, sections.DISCIPLINE + 1, dispEnd, players);
  }

  if (players.length < 5) return null;

  return {
    match: { date, opponent: '', competition, homeTeamName, awayTeamName },
    players,
    diagnostic
  };
}

/* Localise les en-têtes de sections dans les lignes du PDF. */
function findFdmiSections(lines) {
  const result = {};
  const headers = {
    COMPOSITION: /^COMPOSITION$/,
    REMPLACANTS: /^REMPLA[ÇC]ANTS$/,
    BANC: /^BANC$/,
    REMPLACEMENT: /^REMPLACEMENTS?$/,
    DISCIPLINE: /^(DISCIPLINE|SANCTIONS?|CARTONS?|AVERTISSEMENTS?|FAITS\s+DISCIPLINAIRES?)$/,
    BLESSURES: /^BLESSURES?$/,
    BUTEURS: /^BUTEURS$/
  };
  lines.forEach((l, i) => {
    for (const [k, re] of Object.entries(headers)) {
      if (re.test(l.trim())) result[k] = i;
    }
  });
  return result;
}

function findNextSection(lines, from) {
  for (let i = from; i < lines.length; i++) {
    if (/^[A-ZÀ-Ö'\s]{4,}$/.test(lines[i].trim()) && lines[i].trim().length < 30) return i;
  }
  return lines.length;
}

/* Parse une ligne à deux colonnes (domicile | extérieur) délimitées
   par des numéros de licence (9-10 chiffres). */
function parseDoubleColumnLine(line, opts = {}) {
  if (!line) return null;
  const licenceRe = /\b\d{9,10}\b/g;
  const lic = [];
  let m;
  while ((m = licenceRe.exec(line)) !== null) {
    lic.push({ value: m[0], start: m.index, end: m.index + m[0].length });
  }
  if (lic.length < 1) return null;

  const res = {};

  // Côté domicile : du début jusqu'à la 1re licence
  const homeText = line.slice(0, lic[0].start).trim();
  const homeAfter = line.slice(lic[0].end, lic[1] ? lic[1].start : line.length).trim();
  const home = parsePlayerTokens(homeText);
  if (home) {
    home.licence = lic[0].value;
    if (opts.detectNotPlayed && /N'a pas particip/i.test(homeAfter)) home.didNotPlay = true;
    res.home = home;
  }

  // Côté extérieur
  if (lic.length >= 2) {
    let awayStart = lic[0].end;
    // S'il y a "N'a pas participé" entre les deux, on le consomme
    const between = line.slice(lic[0].end, lic[1].start);
    const npMatch = between.match(/N'a pas particip[eé]/i);
    if (npMatch) awayStart = lic[0].end + npMatch.index + npMatch[0].length;
    const awayText = line.slice(awayStart, lic[1].start).trim();
    const awayAfter = line.slice(lic[1].end).trim();
    const away = parsePlayerTokens(awayText);
    if (away) {
      away.licence = lic[1].value;
      if (opts.detectNotPlayed && /N'a pas particip/i.test(awayAfter)) away.didNotPlay = true;
      res.away = away;
    }
  }

  return Object.keys(res).length > 0 ? res : null;
}

/* Extrait (numero, nom, prénom) d'un bloc texte. Le nom est la séquence
   de mots en MAJUSCULES au début ; le prénom suit en casse mixte. */
function parsePlayerTokens(text) {
  if (!text) return null;
  text = text.replace(/\(Capitaine\)/gi, '').replace(/\s+/g, ' ').trim();
  const m = text.match(/^(\d{1,2})\s+(.+)$/);
  if (!m) return null;
  const number = m[1];
  const words = m[2].split(/\s+/);
  const last = [], first = [];
  let inLast = true;
  for (const w of words) {
    if (inLast && /^[A-ZÀ-Ö][A-ZÀ-Ö\-']*$/.test(w)) last.push(w);
    else { inLast = false; first.push(w); }
  }
  if (last.length === 0) return null;
  return {
    number,
    lastName: last.join(' '),
    firstName: first.join(' '),
    didNotPlay: false
  };
}

/* Parse une ligne de but :
   "Orleans Us 45 1606020252 9 - EL KHOUMISTI Fahd Du pied Passe 22 - MOREL Jordan 62' + 0'"
   Retour : { scorerNumber, scorerLast, assistNumber?, assistLast? }
*/
function parseGoalLine(line) {
  if (!line) return null;
  // Un but mentionne toujours une minute
  if (!/\d{1,3}'\s*\+\s*\d+'/.test(line)) return null;
  const re = /(\d{9,10})\s+(\d{1,2})\s+-\s+([A-ZÀ-Ö][A-ZÀ-Ö\-'\s]*?)\s+([A-ZÀ-Ö][a-zà-öø-ÿ]+(?:\s+[A-ZÀ-Ö][a-zà-öø-ÿ]+)*)\s+(Du pied|De la tête|Du genou|Autre|Sur\s+.+?|Penalty)\s+(Aucune|Passe|[A-ZÀ-Ö].*?)(?:\s+(\d{1,2})\s+-\s+([A-ZÀ-Ö][A-ZÀ-Ö\-'\s]*?)\s+([A-ZÀ-Ö][a-zà-öø-ÿ]+))?\s+(\d{1,3})'\s*\+\s*\d+'/;
  const m = line.match(re);
  if (!m) return null;
  return {
    scorerNumber: m[2],
    scorerLast: m[3].trim(),
    scorerFirst: m[4].trim(),
    action: m[6].trim(),
    assistNumber: m[7] || null,
    assistLast: m[8] ? m[8].trim() : null,
    assistFirst: m[9] ? m[9].trim() : null,
    minute: Number(m[10])
  };
}

/* Parse les événements de substitution dans la section REMPLACEMENT.
   Stratégie : pour chaque ligne, on repère les refs joueurs (#NN - NOM) et les minutes
   dans l'ordre de position, puis on associe chaque paire (out, in) à la minute qui suit.
   Si leftText/rightText sont disponibles, on traite les colonnes séparément.
   Met à jour les minutes des joueurs impactés.
*/
function parseRemplacementRows(rows, fromIdx, toIdx, players) {
  // Les événements de substitution utilisent les licences comme ancres.
  // Sur chaque ligne (par colonne), on trouve des couples de licences + une minute :
  //   licence_sortant  (...NOM Prénom sortant...)  licence_entrant  (...NOM Prénom entrant...)  minute'
  // Les noms peuvent wrapper sur 2-3 lignes visuelles ; on concatène donc toutes les
  // lignes de la section par colonne avant de parser.
  const byLicence = {};
  players.forEach(p => { if (p.licence) byLicence[p.licence] = p; });

  const inMin = new Map();
  const outMin = new Map();

  // Concatène le contenu de toutes les lignes pour un extracteur donné (left/right/text).
  const mergeColumn = (pick) => {
    const parts = [];
    for (let i = fromIdx; i < toIdx; i++) {
      const row = rows[i];
      if (row) {
        const v = pick(row);
        if (v) parts.push(v);
      }
    }
    return parts.join(' ');
  };

  // Extrait licences et minutes dans l'ordre de position, apparie chaque minute avec les
  // 2 licences qui la précèdent (out=1re, in=2e).
  const processColumn = (colText) => {
    if (!colText) return;
    const tokens = [];
    const licRe = /\b(\d{9,10})\b/g;
    const minRe = /\b(\d{1,3})'(?:\s*\+\s*\d+')?/g;
    let m;
    while ((m = licRe.exec(colText)) !== null)
      tokens.push({ type: 'lic', licence: m[1], pos: m.index });
    while ((m = minRe.exec(colText)) !== null)
      tokens.push({ type: 'min', minute: Number(m[1]), pos: m.index });
    tokens.sort((a, b) => a.pos - b.pos);

    let pending = [];
    for (const tok of tokens) {
      if (tok.type === 'lic') {
        pending.push(tok);
      } else {
        while (pending.length >= 2) {
          const outLic = pending.shift();
          const inLic  = pending.shift();
          const outP = byLicence[outLic.licence];
          const inP  = byLicence[inLic.licence];
          if (outP) outMin.set(outP, tok.minute);
          if (inP)  inMin.set(inP,  tok.minute);
        }
        pending = [];
      }
    }
  };

  const leftMerged  = mergeColumn(r => r.leftText);
  const rightMerged = mergeColumn(r => r.rightText);
  if (leftMerged || rightMerged) {
    processColumn(leftMerged);
    processColumn(rightMerged);
  } else {
    processColumn(mergeColumn(r => r.text));
  }

  // Applique : titulaire sorti → minutes = outMin ; sub entré → minutes = 90 − inMin.
  players.forEach(p => {
    const i = inMin.get(p);
    const o = outMin.get(p);
    if (p.starter) {
      if (o != null) p.minutes = o;
    } else if (!p.didNotPlay) {
      if (i != null) p.minutes = o != null ? Math.max(0, o - i) : Math.max(0, 90 - i);
    }
  });
}

/* Parse la section DISCIPLINE.
   Les cartons sont des rectangles colorés dans le PDF (pas du texte).
   On utilise les flags yellowCard/redCard posés lors de l'extraction PDF (getOperatorList).
   On identifie ensuite le joueur par le numéro de licence ou de maillot présent sur la même ligne.
*/
function parseDisciplineRows(rows, fromIdx, toIdx, players) {
  // Index licence → player
  const byLicence = {};
  players.forEach(p => { if (p.licence) byLicence[p.licence] = p; });

  for (let i = fromIdx; i < toIdx; i++) {
    const row = rows[i];
    if (!row) continue;
    // Si aucun carton détecté via les rectangles PDF → tente la méthode texte (carton rouge = mot-clé)
    const hasVisualCard = row.yellowCard || row.redCard;
    const isRed = row.redCard || /\b(rouge|exclusion|2\s*[eèé]me?\s*avertissement)\b/i.test(row.text);
    const isYellow = !isRed && (row.yellowCard || false);
    if (!hasVisualCard) {
      // Pas de flag visuel : on essaie de détecter via mots-clés (rouge seulement, jaune ambigu)
      if (!/\b(rouge|exclusion|jaune|avertissement)\b/i.test(row.text)) continue;
    }

    const line = row.text;
    if (/^Equipe\b/i.test(line)) continue;

    // Cherche d'abord par licence (10 chiffres)
    let target = null;
    const licenceM = line.match(/\b(\d{9,10})\b/);
    if (licenceM) target = byLicence[licenceM[1]];

    // Sinon par numéro de maillot dans la ligne
    if (!target) {
      const numM = line.match(/\b(\d{1,2})\s*-\s*([A-ZÀ-Ö][A-ZÀ-Ö\-']+)/);
      if (numM) {
        const num = numM[1], nLast = normalizeName(numM[2]);
        target = players.find(p =>
          String(p.number) === num &&
          normalizeName(p.lastName).startsWith(nLast.slice(0, 4))
        );
      }
    }

    if (target) {
      if (isRed) target.redCards = (target.redCards || 0) + 1;
      else        target.yellowCards = (target.yellowCards || 0) + 1;
    }
  }
}

function buildDiagText(parsed, rawLines) {
  const d = parsed && parsed.diagnostic;
  if (!d) return '';
  const secNames = Object.entries(d.sections)
    .map(([k, v]) => `${k}@ligne${v}`).join(' · ');
  const remLines = (d.remplacementRows || []).map((r, i) =>
    `[${i}] TEXT: ${r.text}\n    LEFT: ${r.left || '(vide)'}\n    RIGHT: ${r.right || '(vide)'}`
  ).join('\n');
  const discLines = (d.disciplineRows || []).map((r, i) =>
    `[${i}] TEXT: ${r.text}\n    🟨=${r.yellowCard || false} 🟥=${r.redCard || false}\n    LEFT: ${r.left || '(vide)'}\n    RIGHT: ${r.right || '(vide)'}`
  ).join('\n');
  return `=== SECTIONS DETECTÉES ===\n${secNames || '(aucune)'}\n\n=== REMPLACEMENT (${(d.remplacementRows||[]).length} lignes) ===\n${remLines || '(section non trouvée)'}\n\n=== DISCIPLINE (${(d.disciplineRows||[]).length} lignes) ===\n${discLines || '(section non trouvée)'}`;
}

function openPdfFdmiModal(rawLines, parsed) {
  const sample = rawLines.slice(0, 200).join('\n');
  const diagText = buildDiagText(parsed, rawLines);
  const playersHtml = parsed && parsed.players.length
    ? `<div class="hint" style="margin-top:8px;">${parsed.players.length} joueurs détectés automatiquement.</div>`
    : `<div class="hint" style="margin-top:8px; color:var(--warning);">Aucun joueur détecté. Copiez le texte brut ci-dessous et envoyez-le à votre assistant pour adapter le parseur.</div>`;

  openModal(`
    <h3>Import FDMI PDF</h3>
    ${playersHtml}
    ${parsed ? renderParsedPreview(parsed) : ''}
    <div class="matches-section">
      <h4>🔍 Diagnostic REMPLACEMENT & DISCIPLINE</h4>
      <textarea readonly id="diag-area" style="width:100%; height:160px; font-family:monospace; font-size:10px; background:var(--bg-card); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:8px;">${escapeHtml(diagText)}</textarea>
      <button class="btn small" id="copy-diag" style="margin-top:4px;">📋 Copier le diagnostic</button>
    </div>
    <div class="matches-section">
      <h4>Texte brut extrait du PDF (${rawLines.length} lignes)</h4>
      <textarea readonly style="width:100%; height:180px; font-family:monospace; font-size:11px; background:var(--bg-card); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:8px;">${escapeHtml(sample)}</textarea>
      <button class="btn small" id="copy-raw" style="margin-top:6px;">📋 Copier le texte brut</button>
    </div>
    <div class="modal-actions">
      <button class="btn" data-close>Fermer</button>
      ${parsed ? `<button class="btn primary" id="confirm-pdf-import">Continuer vers l'appariement</button>` : ''}
    </div>
  `);

  document.getElementById('copy-diag').addEventListener('click', () => {
    navigator.clipboard.writeText(diagText);
    alert('Diagnostic copié !');
  });

  document.getElementById('copy-raw').addEventListener('click', () => {
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

  // Auto-détection de votre équipe : celle avec le plus de correspondances
  const homeMatches = fdmi.players.filter(p => p.team === 'home' && matchSquadPlayer(p)).length;
  const awayMatches = fdmi.players.filter(p => p.team === 'away' && matchSquadPlayer(p)).length;
  const mySide = homeMatches >= awayMatches ? 'home' : 'away';
  const myTeamName = mySide === 'home' ? matchInfo.homeTeamName : matchInfo.awayTeamName;
  const opponentName = mySide === 'home' ? matchInfo.awayTeamName : matchInfo.homeTeamName;

  // On ne garde que les joueurs de VOTRE équipe (si team est défini)
  const relevantPlayers = fdmi.players.filter(p => !p.team || p.team === mySide);

  const rows = relevantPlayers.map((fp, i) => {
    const squadP = matchSquadPlayer(fp);
    return {
      fp,
      squadP,
      index: i,
      include: !!squadP && !fp.didNotPlay && (fp.starter || fp.minutes > 0 || fp.goals > 0 || fp.assists > 0)
    };
  });

  const matched = rows.filter(r => r.squadP).length;
  const unmatched = rows.filter(r => !r.squadP);

  openModal(`
    <h3>Aperçu FDMI</h3>
    <div class="card-sub" style="margin-bottom:10px;">
      ${matchInfo.date ? '📅 ' + escapeHtml(matchInfo.date) : ''}
      ${myTeamName ? ' · ' + escapeHtml(myTeamName) : ''}
      ${opponentName ? ' vs ' + escapeHtml(opponentName) : ''}
      ${matchInfo.competition ? ' · ' + escapeHtml(matchInfo.competition) : ''}
    </div>
    <div class="hint" style="margin-bottom:10px;">
      ${matched} / ${rows.length} joueurs de votre équipe appariés avec l'effectif.
      ${unmatched.length > 0 ? ` <span style="color:var(--warning)">${unmatched.length} non reconnu(s).</span>` : ''}
    </div>
    <div class="form-row" style="margin-bottom:10px;">
      <label>Date du match<input type="date" id="fdmi-date" value="${escapeAttr(matchInfo.date || new Date().toISOString().slice(0,10))}" /></label>
      <label>Adversaire<input id="fdmi-opponent" value="${escapeAttr(opponentName || matchInfo.opponent || '')}" /></label>
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
          <th class="num">PD</th>
          <th class="num" title="Carton jaune">🟨</th>
          <th class="num" title="Carton rouge">🟥</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr style="${r.squadP ? '' : 'opacity:0.5;'}">
            <td><input type="checkbox" data-i="${r.index}" ${r.include ? 'checked' : ''} ${r.squadP ? '' : 'disabled'}></td>
            <td>${r.fp.number ? '#' + escapeHtml(r.fp.number) + ' ' : ''}${escapeHtml(r.fp.firstName)} ${escapeHtml(r.fp.lastName)}${r.fp.didNotPlay ? ' <em style="color:var(--text-dim);">(non entré)</em>' : ''}</td>
            <td>${r.squadP ? escapeHtml(r.squadP.firstName + ' ' + r.squadP.lastName) : '<em>non trouvé</em>'}</td>
            <td class="num">${r.fp.starter ? 'T' : 'R'}</td>
            <td class="num"><input type="number" data-min="${r.index}" value="${r.fp.minutes || 0}" min="0" max="120" style="width:50px; background:var(--bg-card); border:1px solid var(--border); color:var(--text); padding:2px 4px; border-radius:4px;"></td>
            <td class="num">${r.fp.goals || 0}</td>
            <td class="num">${r.fp.assists || 0}</td>
            <td class="num"><input type="number" data-yc="${r.index}" value="${r.fp.yellowCards || 0}" min="0" max="2" style="width:38px; background:var(--bg-card); border:1px solid var(--border); color:var(--text); padding:2px 4px; border-radius:4px;"></td>
            <td class="num"><input type="number" data-rc="${r.index}" value="${r.fp.redCards || 0}" min="0" max="1" style="width:38px; background:var(--bg-card); border:1px solid var(--border); color:var(--text); padding:2px 4px; border-radius:4px;"></td>
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
    // Récupère les champs éditables
    const edited = {};
    document.querySelectorAll('input[type="number"][data-min]').forEach(inp => {
      edited[inp.dataset.min] = edited[inp.dataset.min] || {};
      edited[inp.dataset.min].minutes = Number(inp.value) || 0;
    });
    document.querySelectorAll('input[type="number"][data-yc]').forEach(inp => {
      edited[inp.dataset.yc] = edited[inp.dataset.yc] || {};
      edited[inp.dataset.yc].yellowCards = Number(inp.value) || 0;
    });
    document.querySelectorAll('input[type="number"][data-rc]').forEach(inp => {
      edited[inp.dataset.rc] = edited[inp.dataset.rc] || {};
      edited[inp.dataset.rc].redCards = Number(inp.value) || 0;
    });
    let added = 0;
    rows.forEach(r => {
      if (!included.has(r.index) || !r.squadP) return;
      const e = edited[r.index] || {};
      r.squadP.matches = r.squadP.matches || [];
      r.squadP.matches.push({
        id: uid(),
        date,
        opponent,
        starter: !!r.fp.starter,
        minutes: e.minutes != null ? e.minutes : (Number(r.fp.minutes) || 0),
        goals: Number(r.fp.goals) || 0,
        assists: Number(r.fp.assists) || 0,
        yellowCards: e.yellowCards != null ? e.yellowCards : (Number(r.fp.yellowCards) || 0),
        redCards: e.redCards != null ? e.redCards : (Number(r.fp.redCards) || 0),
        notes: 'Import FDMI'
      });
      added++;
    });
    saveState(); closeModal(); renderSquad();
    alert(`✅ ${added} performance(s) ajoutée(s).`);
  });
}

/* =========================================================
   IMPORT EXCEL (effectif saison complète)
   Format attendu (feuille unique) :
     Ligne 1 : Date | (vides) | date match 1 | ... | date match N
     Ligne 2 : Adversaires
     Ligne 3 : Lieu (Domicile/Extérieur)
     Ligne 4 : Résultat (Victoire/Défaite/Nul)
     Ligne 5 : Points
     Ligne 6 : Score
     Ligne 7 : Différence de buts
     Ligne 8 : En-têtes colonnes
                N° | Prénom | Nom | Poste | Âge | Pied
                puis par match : Poste | Temps de jeu | But | P.D. | _ | _ | Note
     Ligne 9+ : Joueurs
   On ne retient que les statuts T (titulaire) et R (remplaçant entré).
   ========================================================= */
const EXCEL_POSITION_MAP = {
  'gardien': 'Gardien',
  'central': 'Défenseur central',
  'défenseur central': 'Défenseur central',
  'defenseur central': 'Défenseur central',
  'latéral': 'Latéral',
  'lateral': 'Latéral',
  'milieu': 'Milieu central',
  'milieu défensif': 'Milieu défensif',
  'milieu defensif': 'Milieu défensif',
  'milieu central': 'Milieu central',
  'milieu offensif': 'Milieu offensif',
  'ailier': 'Ailier',
  'attaquant': 'Attaquant'
};

function normalizeExcelPosition(raw) {
  if (!raw) return '';
  const k = String(raw).trim().toLowerCase();
  return EXCEL_POSITION_MAP[k] || String(raw).trim();
}

function excelDateToIso(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    // +12h pour éviter le décalage timezone (Excel date à 23:59 UTC → jour précédent)
    const d = new Date(v.getTime() + 12 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return '';
    const mm = String(d.m).padStart(2, '0');
    const dd = String(d.d).padStart(2, '0');
    return `${d.y}-${mm}-${dd}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const yyyy = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${yyyy}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  return s;
}

function parseSquadExcelGrid(grid, colorMap) {
  if (!grid || grid.length < 5) throw new Error('Feuille trop courte.');
  colorMap = colorMap || {};

  // --- Détection dynamique de la ligne d'en-têtes joueurs ---
  // On cherche la ligne qui contient "N°" (ou un entier) en col 0 et "Prénom"/"Nom" en col 1-2
  let headerRowIdx = -1;
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const row = grid[r] || [];
    const v0 = String(row[0] || '').trim();
    const v1 = String(row[1] || '').trim().toLowerCase();
    if ((v0 === 'N°' || v0 === 'No' || v0 === '#') && (v1.startsWith('pr') || v1 === 'firstname')) {
      headerRowIdx = r; break;
    }
  }
  if (headerRowIdx === -1) headerRowIdx = 7; // fallback

  const headerRow = grid[headerRowIdx] || [];

  // --- Détection de la première colonne de match ---
  let posCount = 0;
  let firstMatchCol = -1;
  for (let c = 0; c < headerRow.length; c++) {
    if (String(headerRow[c] || '').trim().toLowerCase() === 'poste') {
      posCount++;
      if (posCount === 2) { firstMatchCol = c; break; }
    }
  }
  if (firstMatchCol === -1) firstMatchCol = 6;

  // --- Détection automatique des lignes de metadata ---
  // On scanne TOUTES les lignes avant l'en-tête pour trouver dates, adversaires, lieu, résultat.
  // On identifie la ligne "dates" comme celle avec le plus de valeurs dans les colonnes de match.
  let datesRowIdx = -1, opponentsRowIdx = -1, venuesRowIdx = -1, resultsRowIdx = -1;
  let maxDateCols = 0;
  for (let r = 0; r < headerRowIdx; r++) {
    const row = grid[r] || [];
    let dateCols = 0;
    for (let c = firstMatchCol; c < row.length; c++) {
      const v = row[c];
      if (v != null && v !== '') dateCols++;
    }
    if (dateCols > maxDateCols) { maxDateCols = dateCols; datesRowIdx = r; }
  }

  // Rows adjacentes à datesRowIdx pour adversaires / lieu / résultat
  const datesRow     = datesRowIdx >= 0 ? (grid[datesRowIdx] || []) : [];
  const opponentsRow = datesRowIdx >= 0 ? (grid[datesRowIdx + 1] || []) : [];
  const venuesRow    = datesRowIdx >= 0 ? (grid[datesRowIdx + 2] || []) : [];
  const resultsRow   = datesRowIdx >= 0 ? (grid[datesRowIdx + 3] || []) : [];

  // --- Détection des matchs ---
  const allDateCells = [];
  for (let c = firstMatchCol - 1; c < datesRow.length; c++) {
    const v = datesRow[c];
    if (v != null && v !== '') allDateCells.push({ c, v });
  }

  const matches = [];
  const seenCols = new Set();
  for (const { c, v } of allDateCells) {
    const isoDate = excelDateToIso(v);
    if (!isoDate) continue;
    const offset = (c - firstMatchCol) % 7;
    const col = offset >= 0 ? c - offset : c - (offset + 7);
    const safeCol = col < firstMatchCol ? firstMatchCol : col;
    if (seenCols.has(safeCol)) continue;
    seenCols.add(safeCol);
    const opp = String(opponentsRow[c] || opponentsRow[safeCol] || '').trim();
    const venue = String(venuesRow[c] || venuesRow[safeCol] || '').trim();
    const result = String(resultsRow[c] || resultsRow[safeCol] || '').trim();
    matches.push({ col: safeCol, date: isoDate, opponent: opp, venue, result });
  }
  matches.sort((a, b) => a.col - b.col);

  // --- Parsing joueurs (lignes après la ligne d'en-têtes) ---
  const players = [];
  for (let r = headerRowIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const number = row[0];
    const firstName = String(row[1] || '').trim();
    const lastName = String(row[2] || '').trim();
    if (!firstName && !lastName) continue;
    const position = normalizeExcelPosition(row[3]);
    const age = row[4] ? Number(row[4]) || '' : '';
    const foot = String(row[5] || '').trim();

    const playerMatches = [];
    for (const m of matches) {
      const status = String(row[m.col] || '').trim().toUpperCase();
      if (status !== 'T' && status !== 'R') continue;
      const minutes = Number(row[m.col + 1]) || 0;
      const goals   = Number(row[m.col + 2]) || 0;
      const assists = Number(row[m.col + 3]) || 0;
      // Cartons : soit valeur numérique dans la cellule, soit cellule colorée (jaune/rouge)
      let yellowCards = Number(row[m.col + 4]) || 0;
      let redCards    = Number(row[m.col + 5]) || 0;
      const yColor = classifyCardColor(colorMap[`${r},${m.col + 4}`]);
      const rColor = classifyCardColor(colorMap[`${r},${m.col + 5}`]);
      if (yColor === 'yellow' && !yellowCards) yellowCards = 1;
      if (rColor === 'red' && !redCards) redCards = 1;
      // Fallback : certaines feuilles n'ont qu'UNE colonne "cartons" coloriée dans l'une des deux
      if (yColor === 'red' && !redCards) redCards = 1;
      if (rColor === 'yellow' && !yellowCards) yellowCards = 1;
      playerMatches.push({
        id: uid(),
        date: m.date, opponent: m.opponent, venue: m.venue, result: m.result,
        starter: status === 'T',
        minutes, goals, assists,
        yellowCards, redCards,
        notes: 'Import Excel'
      });
    }

    players.push({
      id: uid(),
      number: number != null && number !== '' ? String(number) : '',
      firstName, lastName, position, age, foot, notes: '',
      matches: playerMatches
    });
  }

  // Diagnostic console pour debug
  console.log('[Excel import] headerRowIdx=', headerRowIdx, 'firstMatchCol=', firstMatchCol);
  console.log('[Excel import] matches=', matches.length, 'players=', players.length);
  // Log cartons du 1er joueur ayant des cartons
  const pWithCards = players.find(p => p.matches.some(m => m.yellowCards > 0 || m.redCards > 0));
  if (pWithCards) {
    console.log('[Excel import] Joueur avec cartons:', pWithCards.firstName, pWithCards.lastName,
      pWithCards.matches.filter(m => m.yellowCards || m.redCards).map(m => ({ date: m.date, y: m.yellowCards, r: m.redCards })));
  } else {
    console.log('[Excel import] Aucun carton trouvé. Colonnes cartons (1er joueur, 1er match):',
      'col+4=', JSON.stringify(grid[headerRowIdx+1]?.[matches[0]?.col + 4]),
      'col+5=', JSON.stringify(grid[headerRowIdx+1]?.[matches[0]?.col + 5]),
      'headerRow col+4=', JSON.stringify(headerRow[matches[0]?.col + 4]),
      'headerRow col+5=', JSON.stringify(headerRow[matches[0]?.col + 5]));
  }

  return { matches, players };
}

async function readSpreadsheetFile(file) {
  if (!window.XLSX) throw new Error('Librairie XLSX non chargée (vérifiez votre connexion).');
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });

  // Détection des cellules colorées (cartons jaunes / rouges) via parsing XML du xlsx
  let colorMap = null;
  const isXlsx = /\.xlsx$/i.test(file.name);
  if (isXlsx && window.JSZip) {
    try {
      colorMap = await extractCellColors(buffer);
      console.log('[Excel import] colorMap size:', colorMap ? Object.keys(colorMap).length : 0);
    } catch (err) {
      console.warn('[Excel import] Impossible de lire les couleurs:', err);
    }
  }
  return { grid, colorMap };
}

/**
 * Extrait la couleur de fond de chaque cellule du 1er onglet d'un xlsx.
 * Retourne un dict { "r,c": "FFFF00" }.
 */
async function extractCellColors(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const stylesXml = await zip.file('xl/styles.xml').async('string');
  const sheetFile = zip.file('xl/worksheets/sheet1.xml')
    || Object.values(zip.files).find(f => /xl\/worksheets\/sheet\d+\.xml$/i.test(f.name));
  if (!sheetFile) throw new Error('Sheet XML introuvable');
  const sheetXml = await sheetFile.async('string');

  // Parse les fills depuis styles.xml
  const parser = new DOMParser();
  const stylesDoc = parser.parseFromString(stylesXml, 'application/xml');
  const fills = Array.from(stylesDoc.getElementsByTagName('fill')).map(fillEl => {
    const pf = fillEl.getElementsByTagName('patternFill')[0];
    if (!pf) return null;
    const fg = pf.getElementsByTagName('fgColor')[0];
    if (!fg) return null;
    const rgb = fg.getAttribute('rgb');
    return rgb ? rgb.toUpperCase() : null;
  });
  // cellXfs.xf[i].fillId → index dans fills[]
  const cellXfs = stylesDoc.getElementsByTagName('cellXfs')[0];
  const xfs = cellXfs ? Array.from(cellXfs.getElementsByTagName('xf')) : [];
  const xfFillIdx = xfs.map(xf => parseInt(xf.getAttribute('fillId') || '0', 10));

  // Parse les cellules de la feuille
  const sheetDoc = parser.parseFromString(sheetXml, 'application/xml');
  const rows = sheetDoc.getElementsByTagName('row');
  const colorMap = {};
  for (const row of rows) {
    const cells = row.getElementsByTagName('c');
    for (const cell of cells) {
      const ref = cell.getAttribute('r');
      const sAttr = cell.getAttribute('s');
      if (!ref || !sAttr) continue;
      const xfIdx = parseInt(sAttr, 10);
      const fillIdx = xfFillIdx[xfIdx];
      const rgb = fills[fillIdx];
      if (!rgb) continue;
      // Convertit "A15" → {r:14, c:0}
      const rc = refToRC(ref);
      if (!rc) continue;
      colorMap[`${rc.r},${rc.c}`] = rgb;
    }
  }
  return colorMap;
}

function refToRC(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { r: parseInt(m[2], 10) - 1, c: col - 1 };
}

/** Classe une couleur RGB (6 hex) en 'yellow', 'red' ou null. */
function classifyCardColor(rgb) {
  if (!rgb || rgb.length < 6) return null;
  // rgb peut avoir un préfixe alpha: "FFFFFF00"
  const hex = rgb.length === 8 ? rgb.slice(2) : rgb;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  // Jaune : R et G élevés, B faible
  if (r > 200 && g > 150 && b < 120) return 'yellow';
  // Rouge : R élevé, G et B faibles
  if (r > 180 && g < 100 && b < 100) return 'red';
  return null;
}

document.getElementById('import-squad-xlsx')?.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const { grid, colorMap } = await readSpreadsheetFile(file);
    const parsed = parseSquadExcelGrid(grid, colorMap);
    openSquadExcelPreview(parsed);
  } catch (err) {
    console.error(err);
    alert('Erreur à l\'import Excel : ' + err.message);
  }
  e.target.value = '';
});

function openSquadExcelPreview({ matches, players }) {
  const activePlayers = players.filter(p => p.matches.length > 0);
  const rowsHtml = players.map(p => {
    const t = totals(p.matches);
    return `
      <tr>
        <td class="num">${escapeHtml(p.number)}</td>
        <td>${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</td>
        <td>${escapeHtml(p.position)}</td>
        <td class="num">${t.matches}</td>
        <td class="num">${t.starts}</td>
        <td class="num">${t.subs}</td>
        <td class="num">${t.minutes}'</td>
        <td class="num">${t.goals}</td>
        <td class="num">${t.assists}</td>
        <td class="num">${t.yellowCards}</td>
        <td class="num">${t.redCards}</td>
      </tr>
    `;
  }).join('');

  openModal(`
    <h3>Aperçu de l'import Excel</h3>
    <div class="card-sub">${matches.length} match(s) détectés — ${players.length} joueur(s), dont ${activePlayers.length} avec au moins une apparition (T ou R).</div>
    <div style="max-height:55vh; overflow:auto; margin-top:12px;">
      <table class="matches-table">
        <thead>
          <tr>
            <th>#</th><th>Joueur</th><th>Poste</th>
            <th>M</th><th>T</th><th>R</th>
            <th>Min</th><th>B</th><th>PD</th>
            <th>🟨</th><th>🟥</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" data-close>Annuler</button>
      <button type="button" class="btn primary" id="excel-import-confirm">Remplacer l'effectif (${players.length} joueurs)</button>
    </div>
  `);

  document.getElementById('excel-import-confirm').addEventListener('click', () => {
    if (!confirm('Cet import remplace intégralement l\'effectif actuel et son historique. Continuer ?')) return;
    state.squad = players;
    saveState();
    closeModal();
    renderSquad();
    renderProjection();
    alert(`✅ ${players.length} joueurs importés (${activePlayers.length} avec apparitions).`);
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
   IMPORT FLASHSCORE (JSON généré par scrape-flashscore.js)
   ========================================================= */
document.getElementById('import-flashscore')?.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const matches = Array.isArray(data) ? data : [data];
    openFlashscorePreview(matches);
  } catch (err) {
    alert('Erreur lecture FlashScore JSON : ' + err.message);
  }
  e.target.value = '';
});

function openFlashscorePreview(matches) {
  const teamKw = ['orl\u00e9ans', 'orleans'];
  const isOrleans = (name) => teamKw.some(k => (name||'').toLowerCase().includes(k));

  const matchRows = matches.map((m, idx) => {
    const isHome = isOrleans(m.home);
    const opponent = isHome ? m.away : m.home;
    const venue = isHome ? 'Domicile' : 'Ext\u00e9rieur';
    const ourPlayers = (m.players || []).filter(p => {
      if (p.team === 'home' && isHome) return true;
      if (p.team === 'away' && !isHome) return true;
      return p.team === 'unknown';
    });

    const title = m.title || ((m.home && m.away) ? `${m.home} - ${m.away}` : '');

    return {
      idx, date: m.date || '', opponent, venue,
      round: m.round || '',
      title,
      score: `${m.scoreHome || '?'} - ${m.scoreAway || '?'}`,
      scoreHome: isHome ? m.scoreHome : m.scoreAway,
      scoreAway: isHome ? m.scoreAway : m.scoreHome,
      players: ourPlayers
    };
  });

  const rowsHtml = matchRows.map(m => `
    <tr>
      <td><input type="checkbox" data-midx="${m.idx}" checked /></td>
      <td>${escapeHtml(m.date)}</td>
      <td>${escapeHtml(m.round)}</td>
      <td>${escapeHtml(m.title || m.opponent)}</td>
      <td>${escapeHtml(m.venue)}</td>
      <td class="num">${escapeHtml(m.score)}</td>
      <td class="num">${m.players.length}</td>
    </tr>
  `).join('');

  openModal(`
    <h3>\u26A1 Import FFF</h3>
    <div class="card-sub">${matches.length} match(s) trouv\u00e9(s). Cochez ceux \u00e0 importer.</div>
    <div style="max-height:50vh; overflow:auto; margin-top:12px;">
      <table class="matches-table">
        <thead><tr><th></th><th>Date</th><th>Journée</th><th>Match</th><th>Lieu</th><th>Score</th><th>Joueurs</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" data-close>Annuler</button>
      <button type="button" class="btn primary" id="fs-import-confirm">Importer la s\u00e9lection</button>
    </div>
  `);

  document.getElementById('fs-import-confirm').addEventListener('click', () => {
    const checks = document.querySelectorAll('[data-midx]');
    let added = 0;

    checks.forEach(cb => {
      if (!cb.checked) return;
      const m = matchRows[Number(cb.dataset.midx)];
      if (!m) return;

      for (const fp of m.players) {
        const nameParts = (fp.name || '').trim().split(/\s+/);
        const lastName = nameParts.filter(w => w === w.toUpperCase() && w.length > 1).join(' ') || nameParts.slice(-1).join('');
        const firstName = nameParts.filter(w => w !== w.toUpperCase() || w.length <= 1).join(' ') || nameParts.slice(0, -1).join(' ');

        let squadP = state.squad.find(p =>
          p.lastName.toUpperCase() === lastName.toUpperCase() ||
          (p.number && p.number === fp.number)
        );

        if (!squadP) {
          squadP = state.squad.find(p => {
            const fullSq = (p.firstName + ' ' + p.lastName).toLowerCase();
            const fullFs = fp.name.toLowerCase();
            return fullSq.includes(fullFs) || fullFs.includes(p.lastName.toLowerCase());
          });
        }

        if (!squadP) continue;

        const alreadyIdx = (squadP.matches || []).findIndex(em =>
          em.date === m.date && (em.opponent === m.opponent || em.notes === 'Import FFF')
        );

        squadP.matches = squadP.matches || [];

        const matchData = {
          id: alreadyIdx >= 0 ? squadP.matches[alreadyIdx].id : uid(),
          date: m.date,
          opponent: m.opponent,
          venue: m.venue,
          round: m.round || '',
          title: m.title || '',
          scoreHome: m.scoreHome || '',
          scoreAway: m.scoreAway || '',
          starter: fp.starter !== false,
          minutes: Number(fp.minutes) || 0,
          goals: Number(fp.goals) || 0,
          assists: Number(fp.assists) || 0,
          yellowCards: Number(fp.yellowCards) || 0,
          redCards: Number(fp.redCards) || 0,
          notes: 'Import FFF'
        };

        if (alreadyIdx >= 0) {
          squadP.matches[alreadyIdx] = matchData;
        } else {
          squadP.matches.push(matchData);
        }
        added++;
      }
    });

    saveState(); closeModal(); renderSquad();
    alert(`\u2705 ${added} performance(s) ajout\u00e9e(s) depuis FlashScore.`);
  });
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
