/* ============================================================
   SEEDED RNG
============================================================ */
function mulberry32(a){
    return function(){
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function seededShuffle(arr, r){
    for(let i = arr.length - 1; i > 0; i--){
        const j = Math.floor(r() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

/* ============================================================
   DATA
============================================================ */
const PLAYER_LIST = [
    "Антон","Іра","Олександр","Юля",
    "Назар","Тарас","Люба","Анатолій", "Андрій", "Пан Іван", "Саша О"
];

const DEFAULT_SELECTED = new Set(["Антон","Іра","Олександр","Юля","Назар"]);

let highlighterTimer = null;
let latestScheduleSlots = [];

/* ============================================================
   INIT PLAYERS
============================================================ */
function initPlayers(){
    const box = document.getElementById("players");
    PLAYER_LIST.forEach(p=>{
        const checked = DEFAULT_SELECTED.has(p) ? "checked" : "";
        box.insertAdjacentHTML("beforeend",
            `<label><input type="checkbox" id="p_${p}" ${checked}><span>${p}</span></label>`
        );
    });
}

/* ============================================================
   AUTO SEED
============================================================ */
function autoSeed(){
    document.getElementById("seed").value = Math.floor(Math.random()*1e9).toString();
}

/* ============================================================
   NEW — BALANCED PLAYER PICKER
============================================================ */

function scoreCandidateDistribution(cand, playerCount){
    let s = 0;
    for(let p of cand) s += playerCount[p] || 0;
    return s;
}

function chooseBalancedPlayers(players, courts, r, pairCount, recentPairs, playerCount){
    const needed = courts * 2;
    const attempts = 400;

    let best = null;
    let bestScore = Infinity;

    for(let i=0; i<attempts; i++){
        let t = [...players];
        seededShuffle(t, r);

        let cand = t.slice(0, needed);
        let score = 0;

        for(let k=0; k<cand.length; k+=2){
            const A=cand[k], B=cand[k+1];
            const key = A < B ? A+"-"+B : B+"-"+A;

            if(recentPairs.includes(key)) score += 500;
            score += (pairCount[key] || 0) * 15;
        }

        score += scoreCandidateDistribution(cand, playerCount) * 3;

        if(score < bestScore){
            bestScore = score;
            best = cand;
        }
    }
    return best;
}

/* ============================================================
   GENERATE
============================================================ */
function generate(){
    const seed = parseInt(document.getElementById("seed").value) || 1;
    const r = mulberry32(seed);

    const games  = +document.getElementById("games").value;
    const courts = +document.getElementById("courts").value;
    const avoidN = 2;

    const players = PLAYER_LIST.filter(p => document.getElementById("p_"+p).checked);

    if(players.length < courts * 2){
        alert("Замало гравців!");
        return;
    }

    const pairCount = {};
    const playerCount = {};
    players.forEach(p => playerCount[p] = 0);

    const recentPairs = [];
    const results = [];

    for(let g=1; g<=games; g++){

        const chosen = chooseBalancedPlayers(
            players,
            courts,
            r,
            pairCount,
            recentPairs,
            playerCount
        );

        const used = new Set(chosen);
        const rest = players.filter(p => !used.has(p));

        const pairs = [];

        for(let c=0; c<courts; c++){
            const A = chosen[2*c];
            const B = chosen[2*c+1];

            const key = A < B ? A+"-"+B : B+"-"+A;

            pairCount[key] = (pairCount[key] || 0) + 1;
            recentPairs.push(key);

            pairs.push([A,B]);

            playerCount[A]++;
            playerCount[B]++;
        }

        while(recentPairs.length > avoidN * courts)
            recentPairs.shift();

        results.push({ game:g, pairs, rest });
    }

    window._pairCount = pairCount;

    renderTable(results);
    renderStats(playerCount, pairCount);

    document.getElementById("afterGenRow").classList.remove("hidden");
    startGameTimeHighlighter();
}

function renderTable(results){
    const courts = +document.getElementById("courts").value;
    const pc = window._pairCount || {};
    latestScheduleSlots = [];

    /* Read starting time */
    const start = document.getElementById("startTime").value; // "18:40"
    let [sh, sm] = start.split(":").map(Number);
    let currentMinutes = sh * 60 + sm;

    const GAME_DURATION = 10; // 10 minutes per slot

    let html = `<table><tr><th>Час</th>`;
    for(let c=1; c<=courts; c++) html += `<th>Корт ${c}</th>`;
    html += `<th>Відпочивають</th></tr>`;

    results.forEach(r=>{
        const from = currentMinutes;
        const to   = currentMinutes + GAME_DURATION;

        const timeLabel = `${formatTime(from)}–${formatTime(to)}`;
        currentMinutes = to;

        const slot = { time: timeLabel, courts: [], rest: r.rest };

        html += `<tr><td>${timeLabel}</td>`;

        r.pairs.forEach((p, index)=>{
            slot.courts.push({
                court: index + 1,
                players: p
            });
            html += `<td>${p[0]} – ${p[1]}</td>`;
        });

        latestScheduleSlots.push(slot);
        html += `<td>${r.rest.join(", ")}</td></tr>`;
    });

    html += "</table>";
    document.getElementById("tableBox").innerHTML = html;
}


/* ============================================================
   Converts minutes → HH:MM
============================================================ */
function formatTime(totalMinutes){
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getSelectedPlayers() {
    return PLAYER_LIST.filter(p => {
        const el = document.getElementById("p_" + p);
        return el && el.checked;
    });
}

function populatePlayerScheduleSelect() {
    const select = document.getElementById("playerScheduleSelect");
    if (!select) return;

    const players = getSelectedPlayers();
    select.innerHTML = players
        .map(player => `<option value="${escapeHtml(player)}">${escapeHtml(player)}</option>`)
        .join("");
}

function renderPlayerSchedule(player) {
    const result = document.getElementById("playerScheduleResult");
    if (!result || !player) return;

    const matches = [];

    latestScheduleSlots.forEach(slot => {
        let playerMatch = null;

        slot.courts.forEach(courtInfo => {
            if (courtInfo.players.includes(player)) {
                playerMatch = {
                    time: slot.time,
                    court: courtInfo.court,
                    opponent: courtInfo.players.find(p => p !== player),
                    isRest: false
                };
            }
        });

        if (playerMatch) {
            matches.push(playerMatch);
            return;
        }

        if (slot.rest.includes(player)) {
            matches.push({
                time: slot.time,
                isRest: true
            });
        }
    });

    if (!matches.length) {
        result.innerHTML = `<p class="empty-schedule">${escapeHtml(player)} не має ігор у цьому розкладі.</p>`;
        return;
    }

    const items = matches.map(match => {
        if (match.isRest) {
            return `
                <li class="schedule-rest-row">
                    <span class="schedule-time">${escapeHtml(match.time)}</span>
                    <span class="schedule-rest">Відпочинок</span>
                    <span class="schedule-opponent"></span>
                </li>
            `;
        }

        return `
            <li>
                <span class="schedule-time">${escapeHtml(match.time)}</span>
                <span class="schedule-court">Корт ${match.court}</span>
                <span class="schedule-opponent">з ${escapeHtml(match.opponent)}</span>
            </li>
        `;
    }).join("");

    result.innerHTML = `
        <h3>${escapeHtml(player)}</h3>
        <ul class="player-schedule-list">${items}</ul>
    `;
}



/* ============================================================
   RENDER STATS
============================================================ */
function renderStats(playerCount, pairCount){
    let p = "<h3>Ігри гравців</h3><ul>";
    for(const pl in playerCount)
        p+=`<li>${pl}: ${playerCount[pl]}</li>`;
    p+="</ul>";

    let s="<h3>Статистика пар</h3><ul>";
    for(const k in pairCount)
        s+=`<li>${k}: ${pairCount[k]}×</li>`;
    s+="</ul>";

    document.getElementById("statsPlayers").innerHTML = p;
    document.getElementById("statsPairs").innerHTML = s;
}

/* ============================================================
   EXPORT CSV
============================================================ */
function exportCSV(){
    const table = document.querySelector("#tableBox table");
    if(!table) return;

    let csv="";
    table.querySelectorAll("tr").forEach(row=>{
        csv += [...row.children]
            .map(td=>`"${td.innerText}"`)
            .join(",") + "\n";
    });

    const blob=new Blob([csv],{type:"text/csv"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="matches.csv";
    a.click();
}

/* ============================================================
   SHAREABLE LINK
============================================================ */

function b64encodeUnicode(str) {
    return btoa(
        encodeURIComponent(str)
            .replace(/%([0-9A-F]{2})/g, (_, p1) =>
                String.fromCharCode("0x" + p1)
            )
    )
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function b64decodeUnicode(b64) {
    const s = b64.replace(/-/g, "+").replace(/_/g, "/");
    return decodeURIComponent(
        Array.from(atob(s))
            .map(c => "%" + c.charCodeAt(0).toString(16).padStart(2,"0"))
            .join("")
    );
}

/* ============================================================
   ✅ SHARE LINK — compress all settings in Base64
============================================================ */
function shareLink() {
    const seed   = document.getElementById("seed").value;
    const games  = document.getElementById("games").value;
    const courts = document.getElementById("courts").value;
    const start  = document.getElementById("startTime").value;

    const players = PLAYER_LIST.filter(
        p => document.getElementById("p_" + p).checked
    );

    /* повний точний стан */
    const state = {
        s: seed,
        g: games,
        c: courts,
        t: start,
        p: players
    };

    const json = JSON.stringify(state);
    const b64  = b64encodeUnicode(json);

    const url = `${location.origin}${location.pathname}#${b64}`;
    navigator.clipboard.writeText(url);

    alert("Посилання скопійовано!");
}

/* ============================================================
   ✅ LOAD STATE FROM HASH
============================================================ */
function loadFromHash() {
    if (!location.hash) return false;

    let json;
    try {
        json = b64decodeUnicode(location.hash.substring(1));
    } catch {
        return false;
    }

    let state;
    try {
        state = JSON.parse(json);
    } catch {
        return false;
    }

    if (state.s) document.getElementById("seed").value = state.s;
    if (state.g) document.getElementById("games").value = state.g;
    if (state.c) document.getElementById("courts").value = state.c;
    if (state.t) document.getElementById("startTime").value = state.t;

    if (state.p) {
        PLAYER_LIST.forEach(p =>
            document.getElementById("p_"+p).checked = false
        );
        state.p.forEach(p => {
            const el = document.getElementById("p_"+p);
            if (el) el.checked = true;
        });
    }

    return true;
}


/* ============================================================
   ✅ READ‑ONLY VIEW FOR SHARED LINKS (HASH MODE)
   If page is opened WITH hash → show ONLY the table
============================================================ */

function applyReadonlyMode(isShared) {
    if (!isShared) return;

    const hideIds = [
        "playersTitle",
        "players",
        "settingsTitle",
        "statsTitle",
        "statsBox"
    ];

    hideIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add("readonly-hidden");
    });

    // сховати всі кнопки та control-панелі
    document.querySelectorAll(".controls, .row")
        .forEach(el => el.classList.add("readonly-hidden"));

    // залишаємо header
    document.querySelector("header").classList.remove("readonly-hidden");

    // таблиця — головна
    const tableBox = document.getElementById("tableBox");
    tableBox.classList.add("readonly-table-box");

    populatePlayerScheduleSelect();

    const scheduleBox = document.getElementById("playerScheduleBox");
    if (scheduleBox) {
        scheduleBox.classList.remove("readonly-hidden");
    }
}


function highlightCurrentGameRow() {
    const table = document.querySelector("#tableBox table");
    if (!table) return;

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const rows = table.querySelectorAll("tr");

    rows.forEach((row, index) => {
        if (index === 0) return; // skip header

        const timeCell = row.children[0];
        if (!timeCell) return;

        const match = timeCell.innerText.match(/(\d{2}):(\d{2})–(\d{2}):(\d{2})/);
        if (!match) return;

        const start =
            parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
        const end =
            parseInt(match[3], 10) * 60 + parseInt(match[4], 10);

        if (nowMinutes >= start && nowMinutes < end) {
            row.classList.add("current-game");
        } else {
            row.classList.remove("current-game");
        }
    });
}

/* ============================================================
   ✅ AUTO-UPDATE EVERY 30 SECONDS
============================================================ */
function startGameTimeHighlighter() {
    highlightCurrentGameRow();

    if (highlighterTimer) {
        clearInterval(highlighterTimer);
    }

    highlighterTimer = setInterval(highlightCurrentGameRow, 30_000);
}

function bindEvents() {
    document.getElementById("refreshSeed").addEventListener("click", autoSeed);
    document.getElementById("generateBtn").addEventListener("click", generate);
    document.getElementById("exportCsvBtn").addEventListener("click", exportCSV);
    document.getElementById("exportPdfBtn").addEventListener("click", () => window.print());
    document.getElementById("shareBtn").addEventListener("click", shareLink);
    document.getElementById("showPlayerScheduleBtn").addEventListener("click", () => {
        const select = document.getElementById("playerScheduleSelect");
        renderPlayerSchedule(select.value);
    });
}

/* ============================================================
   ✅ INIT
============================================================ */
initPlayers();
bindEvents();
autoSeed();

if (loadFromHash())
{
  generate();
  applyReadonlyMode(true);
}
