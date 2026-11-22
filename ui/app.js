const POLL_MS = 1000;
const $ = (selector) => document.querySelector(selector);

const SLATS = 10;
const SEGMENTS = 20;

// Without a position attribute the state alone decides how much of the opening is covered.
const STATE_CLOSED_RATIO = {
  OPEN: 0,
  OPENING: 0.5,
  CLOSING: 0.5,
  STOPPED: 0.5,
  CLOSED: 1,
};

function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);

  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== false)
      element.setAttribute(key, value === true ? '' : value);
  }

  element.append(
    ...children.flat().filter((c) => c !== undefined && c !== null),
  );

  return element;
}

async function api(path, body) {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();

  if (!response.ok) throw new Error(data.error ?? response.statusText);

  return data;
}

function confirmAction(text) {
  const dialog = $('#confirm');

  $('#confirm-text').textContent = text;
  dialog.showModal();

  return new Promise((resolve) =>
    dialog.addEventListener(
      'close',
      () => resolve(dialog.returnValue === 'ok'),
      { once: true },
    ),
  );
}

async function command(text, path, body) {
  if (!(await confirmAction(text))) return;
  try {
    await api(path, body ?? {});
  } catch (error) {
    alert(error.message);
  }
}

const characteristic = (node, type) =>
  node.homekit?.services
    .flatMap((s) => s.characteristics)
    .find((c) => c.type === type);

function doorSvg(state, closedPercent) {
  const ratio =
    closedPercent === undefined
      ? (STATE_CLOSED_RATIO[state] ?? 0.5)
      : closedPercent / 100;
  const lit = Math.round(ratio * SLATS);
  const slats = Array.from(
    { length: SLATS },
    (_, i) =>
      `<rect class="slat ${i < lit ? 'lit' : ''}" x="12" y="${16 + i * 8.6}" width="96" height="7"/>`,
  ).join('');
  const moving = state === 'OPENING' || state === 'CLOSING';

  return document
    .createRange()
    .createContextualFragment(
      `<svg class="door ${moving ? 'moving' : ''}" viewBox="0 0 120 104" aria-hidden="true"><path class="frame" d="M6 104 V10 H114 V104"/>${slats}</svg>`,
    );
}

function segments(percent) {
  const lit = Math.round((percent / 100) * SEGMENTS);

  return h(
    'div',
    {
      class: 'segments',
      role: 'meter',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(percent),
    },
    Array.from({ length: SEGMENTS }, (_, i) =>
      h('span', { class: i < lit ? 'lit' : undefined }),
    ),
  );
}

const table = (...children) =>
  h('div', { class: 'table-wrap' }, h('table', {}, ...children));

const fact = (term, value, tone) =>
  h(
    'div',
    { class: 'fact' },
    h('dt', {}, term),
    h('span', { class: 'dots', 'aria-hidden': 'true' }),
    h('dd', { class: tone }, value),
  );

function attributeTable(node) {
  return table(
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        ['id', 'attribute', 'current', 'target', 'range', ''].map((t) =>
          h('th', {}, t),
        ),
      ),
    ),
    h(
      'tbody',
      {},
      node.attributes.map((a) =>
        h(
          'tr',
          {},
          h('td', { class: 'num' }, String(a.id)),
          h('td', {}, `${a.name} (${a.type})`),
          h(
            'td',
            { class: 'num' },
            `${a.current}${a.unit ? ` ${a.unit}` : ''}`,
          ),
          h('td', { class: 'num' }, String(a.target)),
          h('td', { class: 'num' }, `${a.min}…${a.max}`),
          h('td', {}, a.editable ? '✎' : ''),
        ),
      ),
    ),
  );
}

function homekitTable(node) {
  return table(
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        ['service', 'characteristic', 'value'].map((t) => h('th', {}, t)),
      ),
    ),
    h(
      'tbody',
      {},
      node.homekit.services.flatMap((service) =>
        service.characteristics.map((c) =>
          h(
            'tr',
            {},
            h('td', {}, service.type),
            h('td', {}, `${c.type}${c.writable ? ' ✎' : ''}`),
            h(
              'td',
              { class: 'num' },
              c.error
                ? `⚠ ${c.error}`
                : `${c.value}${c.label ? ` (${c.label})` : ''}`,
            ),
          ),
        ),
      ),
    ),
  );
}

const RETICLE = {
  OPEN: 'reticle-warn',
  CLOSED: 'reticle-ok',
  OPENING: '',
  CLOSING: '',
};

function gateCard(node, connected) {
  const current = characteristic(node, 'CurrentDoorState');
  const target = characteristic(node, 'TargetDoorState');
  const position = node.attributes.find((a) => a.type === 15);
  const signal = node.attributes.find((a) => a.type === 411);
  const state = current?.label ?? 'UNKNOWN';
  const closedPercent = position
    ? Math.round(
        ((position.current - position.min) /
          (position.max - position.min || 1)) *
          100,
      )
    : undefined;
  const available = node.state === 1;
  const label = `${node.name} (#${node.id})`;

  return h(
    'article',
    { class: 'panel gate' },
    h(
      'header',
      { class: 'panel-head' },
      h(
        'h3',
        { class: `reticle ${RETICLE[state] ?? 'reticle-dim'}` },
        node.name,
      ),
      h('span', { class: 'note' }, `${node.profileName} · #${node.id}`),
    ),
    h(
      'div',
      { class: 'panel-body' },
      doorSvg(state, closedPercent),
      h(
        'div',
        { class: 'readout' },
        h('div', { class: `state ${state}` }, state),
        closedPercent !== undefined && segments(closedPercent),
        h(
          'dl',
          { class: 'facts' },
          fact('target', target?.label ?? '–'),
          fact(
            'position',
            closedPercent === undefined ? '–' : `${closedPercent}% closed`,
          ),
          fact(
            'model',
            `${node.homekit.info.manufacturer} ${node.homekit.info.model}`,
          ),
          fact(
            'reachable',
            available ? 'yes' : `no (state ${node.state})`,
            available ? 'ok' : 'bad',
          ),
          signal && fact('signal', `${signal.current} dBm`),
        ),
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              class: 'btn accent',
              disabled: !connected,
              onclick: () =>
                command(
                  `Open ${label}? The gate will physically move.`,
                  `/api/nodes/${node.id}/homekit`,
                  { characteristic: 'TargetDoorState', value: 0 },
                ),
            },
            'open',
          ),
          h(
            'button',
            {
              class: 'btn',
              disabled: !connected,
              onclick: () =>
                command(`Stop ${label}?`, `/api/nodes/${node.id}/stop`),
            },
            'stop',
          ),
          h(
            'button',
            {
              class: 'btn accent',
              disabled: !connected,
              onclick: () =>
                command(
                  `Close ${label}? Make sure nothing is in the way.`,
                  `/api/nodes/${node.id}/homekit`,
                  { characteristic: 'TargetDoorState', value: 1 },
                ),
            },
            'close',
          ),
        ),
      ),
    ),
    h('details', {}, h('summary', {}, 'homekit mapping'), homekitTable(node)),
    h(
      'details',
      {},
      h('summary', {}, 'homee attributes'),
      attributeTable(node),
    ),
  );
}

function deviceRow(node) {
  return h(
    'details',
    {},
    h(
      'summary',
      { class: 'device' },
      h('span', {}, node.name),
      h('span', { class: 'meta' }, `#${node.id} · ${node.profileName}`),
      h('span', { class: 'dots', 'aria-hidden': 'true' }),
      h(
        'span',
        { class: node.homekit ? 'badge ok' : 'badge' },
        node.homekit
          ? node.homekit.services.map((s) => s.type).join(', ')
          : 'not exposed',
      ),
    ),
    node.homekit && homekitTable(node),
    attributeTable(node),
  );
}

function checks(state) {
  const gates = state.nodes.filter((n) => n.homekit?.kind === 'gate');
  const reached =
    state.status === 'connected' ||
    state.lastSnapshotAt ||
    (state.lastError && !/cannot reach/.test(state.lastError));

  return [
    ['Cube reachable', state.configured ? Boolean(reached) : undefined],
    [
      'Credentials accepted',
      state.status === 'auth-failed'
        ? false
        : reached && state.status !== 'authenticating'
          ? true
          : undefined,
    ],
    [
      'WebSocket connected',
      state.configured ? state.status === 'connected' : undefined,
    ],
    [
      'Snapshot received',
      state.lastSnapshotAt ? true : undefined,
      state.lastSnapshotAt && `${state.nodes.length} nodes`,
    ],
    [
      'Gates recognised',
      state.lastSnapshotAt ? gates.length > 0 : undefined,
      gates.map((g) => g.name).join(', '),
    ],
  ];
}

// Replacing the DOM every poll would collapse open <details>; keep them open by key.
function preserveOpen(container, render) {
  const open = new Set(
    [...container.querySelectorAll('details[open]')].map((d) => d.dataset.key),
  );

  container.replaceChildren(...render());
  container.querySelectorAll('details').forEach((d, i) => {
    d.dataset.key ??= String(i);

    if (open.has(d.dataset.key)) d.open = true;
  });
}

const STATUS_TONE = {
  connected: 'ok',
  connecting: 'warn',
  authenticating: 'warn',
  waiting: 'warn',
  'auth-failed': 'bad',
};

function setStatus(text, tone) {
  $('#status').textContent = text;
  $('#status').className = tone ?? '';
  $('#status-dot').className = `dot ${tone ?? ''}`;
}

const CONNECTION_KEY = 'homee-connection';

function storedConnection() {
  try {
    return JSON.parse(localStorage.getItem(CONNECTION_KEY)) ?? undefined;
  } catch {
    return undefined;
  }
}

function rememberConnection(connection) {
  try {
    localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
  } catch {
    // private mode: the form simply starts empty next time
  }
}

async function connect(connection) {
  await api('/api/connect', connection);
  rememberConnection(connection);
  formTouched = false;
}

const remembered = storedConnection();
let formTouched = Boolean(remembered);
// A server started without --host has nothing to connect to; reuse the last working credentials once.
let autoConnectPending = Boolean(remembered);

if (remembered) {
  for (const [name, value] of Object.entries(remembered)) {
    const field = $('#connect-form').elements.namedItem(name);

    if (field) field.value = value;
  }
}

function render(state) {
  setStatus(state.status, STATUS_TONE[state.status]);
  $('#cube-info').textContent = state.cube
    ? `${state.cube.name || 'homee'} · firmware ${state.cube.version} · ${state.host}`
    : (state.host ?? 'not connected');

  if (!formTouched && state.host) $('#connect-form').host.value = state.host;

  if (autoConnectPending) {
    autoConnectPending = false;

    if (!state.configured)
      connect(remembered).catch((error) => setStatus(error.message, 'bad'));
  }

  $('#error').hidden = !state.lastError;
  $('#error-text').textContent = state.lastError ?? '';

  $('#checklist').replaceChildren(
    ...checks(state).map(([name, ok, detail]) =>
      h(
        'li',
        {},
        h('span', { class: 'name' }, name),
        h('span', { class: 'dots', 'aria-hidden': 'true' }),
        detail && h('span', { class: 'detail' }, detail),
        h(
          'span',
          { class: `badge ${ok === undefined ? '' : ok ? 'ok' : 'bad'}` },
          ok === undefined ? 'pending' : ok ? 'pass' : 'fail',
        ),
      ),
    ),
  );

  const connected = state.status === 'connected';
  const gates = state.nodes.filter((n) => n.homekit?.kind === 'gate');

  preserveOpen($('#gates'), () => gates.map((n) => gateCard(n, connected)));
  preserveOpen($('#devices'), () => {
    const others = state.nodes.filter((n) => n.homekit?.kind !== 'gate');

    return others.length
      ? others.map(deviceRow)
      : [h('p', { class: 'dim' }, 'none')];
  });

  $('#log').replaceChildren(
    ...state.log
      .slice()
      .reverse()
      .map((entry) =>
        h(
          'li',
          { class: entry.level },
          h('time', {}, new Date(entry.at).toLocaleTimeString()),
          entry.message,
        ),
      ),
  );
}

async function poll() {
  try {
    render(await api('/api/state'));
  } catch {
    setStatus('ui server offline', 'bad');
  } finally {
    setTimeout(poll, POLL_MS);
  }
}

$('#connect-form').addEventListener('input', () => (formTouched = true));
$('#connect-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);

  try {
    await connect(Object.fromEntries(form));
  } catch (error) {
    alert(error.message);
  }
});
$('#disconnect').addEventListener('click', () => api('/api/disconnect', {}));
$('#discover').addEventListener('click', async () => {
  const result = $('#discover-result');

  result.textContent = 'scanning local network…';
  try {
    const { hosts } = await api('/api/discover');

    result.replaceChildren(
      hosts.length ? 'found: ' : 'no cube found',
      ...hosts.map((host) =>
        h(
          'button',
          {
            class: 'btn sm',
            type: 'button',
            onclick: () => ($('#connect-form').host.value = host),
          },
          host,
        ),
      ),
    );
  } catch (error) {
    result.textContent = error.message;
  }
});

const THEME_KEY = 'homee-theme';

function paintThemeButton() {
  $('#theme').textContent = document.documentElement.classList.contains('dark')
    ? 'light'
    : 'dark';
}

$('#theme').addEventListener('click', () => {
  const dark = document.documentElement.classList.toggle('dark');

  try {
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  } catch {
    // private mode: the class on <html> still holds for this session
  }

  paintThemeButton();
});
paintThemeButton();

poll();
