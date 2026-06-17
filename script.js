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

function scoreProjectedPlayerBalance(cand, players, playerCount){
    const chosen = new Set(cand);
    const projectedCounts = players.map(player =>
        (playerCount[player] || 0) + (chosen.has(player) ? 1 : 0)
    );
    const min = Math.min(...projectedCounts);
    const max = Math.max(...projectedCounts);
    const squaredLoad = projectedCounts.reduce((sum, count) => sum + count * count, 0);

    return (max - min) * 10000 + squaredLoad;
}

const COURT_PIN_PRIORITY_BASE = 3;

function chooseBalancedPlayers(players, courts, r, pairCount, recentPairs, playerCount){
    const needed = courts * 2;
    const attempts = 400;

    let best = null;
    let bestBalanceScore = Infinity;

    for(let i=0; i<attempts; i++){
        let t = [...players];
        seededShuffle(t, r);

        let cand = t.slice(0, needed);
        const balanceScore = scoreProjectedPlayerBalance(cand, players, playerCount);

        if(balanceScore < bestBalanceScore){
            bestBalanceScore = balanceScore;
            best = cand;
        }
    }
    return best;
}

function getCourtPinPriority(player, courtPinOrder){
    const order = courtPinOrder[player];
    if(!order) return 0;

    return Math.pow(COURT_PIN_PRIORITY_BASE, PLAYER_LIST.length - order);
}

function scorePairOnCourt(pair, court, courtPins, courtPinOrder){
    const leftPin = courtPins[pair[0]] || 0;
    const rightPin = courtPins[pair[1]] || 0;
    let score = 0;

    if(leftPin){
        const priority = getCourtPinPriority(pair[0], courtPinOrder);
        score += leftPin === court ? priority : -priority;
    }

    if(rightPin){
        const priority = getCourtPinPriority(pair[1], courtPinOrder);
        score += rightPin === court ? priority : -priority;
    }

    return score;
}

function getBestCourtArrangement(pairs, courtPins, courtPinOrder, courts){
    const best = {
        score: -Infinity,
        pairs: pairs
    };

    function assign(remaining, court, placed, score){
        if(court > courts){
            if(score > best.score){
                best.score = score;
                best.pairs = placed;
            }
            return;
        }

        for(let i=0; i<remaining.length; i++){
            const pair = remaining[i];
            const nextRemaining = remaining.slice(0, i).concat(remaining.slice(i+1));
            const variants = [
                pair,
                [pair[1], pair[0]]
            ];

            variants.forEach(variant=>{
                assign(
                    nextRemaining,
                    court + 1,
                    placed.concat([variant]),
                    score + scorePairOnCourt(variant, court, courtPins, courtPinOrder)
                );
            });
        }
    }

    assign(pairs, 1, [], 0);
    return best;
}

function arrangePairsByCourt(pairs, courtPins, courtPinOrder, courts){
    return getBestCourtArrangement(pairs, courtPins, courtPinOrder, courts).pairs;
}

function scorePairRepeat(pair, pairCount, recentPairs){
    const A = pair[0];
    const B = pair[1];
    const key = A < B ? A+"-"+B : B+"-"+A;
    let score = 0;

    if(recentPairs.includes(key)) score += 500;
    score += (pairCount[key] || 0) * 15;

    return score;
}

function arrangePlayersIntoPairs(chosen, pairCount, recentPairs, courtPins, courtPinOrder, courts){
    const best = {
        pairScore: Infinity,
        courtScore: -Infinity,
        pairs: []
    };

    function build(remaining, pairs){
        if(remaining.length === 0){
            const arrangement = getBestCourtArrangement(pairs, courtPins, courtPinOrder, courts);
            const pairScore = pairs.reduce(
                (sum, pair) => sum + scorePairRepeat(pair, pairCount, recentPairs),
                0
            );

            if(
                pairScore < best.pairScore ||
                (
                    pairScore === best.pairScore &&
                    arrangement.score > best.courtScore
                )
            ){
                best.pairScore = pairScore;
                best.courtScore = arrangement.score;
                best.pairs = arrangement.pairs;
            }
            return;
        }

        const first = remaining[0];
        for(let i=1; i<remaining.length; i++){
            const pair = [first, remaining[i]];
            const nextRemaining = remaining
                .slice(1, i)
                .concat(remaining.slice(i+1));

            build(nextRemaining, pairs.concat([pair]));
        }
    }

    build(chosen, []);
    return best.pairs;
}

function assignNewCourtPins(pairs, courtPins, courtPinOrder, nextCourtPinOrder){
    pairs.forEach((pair, index)=>{
        const court = index + 1;
        pair.forEach(player=>{
            if(!courtPins[player]){
                courtPins[player] = court;
                courtPinOrder[player] = nextCourtPinOrder.value;
                nextCourtPinOrder.value++;
            }
        });
    });
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
    const courtPins = {};
    const courtPinOrder = {};
    const nextCourtPinOrder = { value: 1 };
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

        let pairs = arrangePlayersIntoPairs(
            chosen,
            pairCount,
            recentPairs,
            courtPins,
            courtPinOrder,
            courts
        );

        pairs.forEach(pair=>{
            const A = pair[0];
            const B = pair[1];
            const key = A < B ? A+"-"+B : B+"-"+A;

            pairCount[key] = (pairCount[key] || 0) + 1;
            recentPairs.push(key);

            playerCount[A]++;
            playerCount[B]++;
        });

        assignNewCourtPins(pairs, courtPins, courtPinOrder, nextCourtPinOrder);

        while(recentPairs.length > avoidN * courts)
            recentPairs.shift();

        results.push({ game:g, pairs, rest });
    }

    window._pairCount = pairCount;

    renderTable(results);
    renderStats(playerCount, pairCount, courtPins, courtPinOrder);

    document.getElementById("afterGenRow").classList.remove("hidden");
    startGameTimeHighlighter();
}

function renderTable(results){
    const courts = +document.getElementById("courts").value;
    const pc = window._pairCount || {};

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

        html += `<tr><td>${timeLabel}</td>`;

        r.pairs.forEach(p=>{
            html += `<td>${p[0]} – ${p[1]}</td>`;
        });

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



/* ============================================================
   RENDER STATS
============================================================ */
function renderStats(playerCount, pairCount, courtPins, courtPinOrder){
    let p = "<h3>Ігри гравців</h3><ul>";
    for(const pl in playerCount)
        p+=`<li>${pl}: ${playerCount[pl]}</li>`;
    p+="</ul>";

    let c = "<h3>Прив'язка до кортів</h3><ul>";
    for(const pl in playerCount){
        const court = courtPins[pl] ? `Корт ${courtPins[pl]} (#${courtPinOrder[pl]})` : "не призначено";
        c+=`<li>${pl}: ${court}</li>`;
    }
    c+="</ul>";

    let s="<h3>Статистика пар</h3><ul>";
    for(const k in pairCount)
        s+=`<li>${k}: ${pairCount[k]}×</li>`;
    s+="</ul>";

    document.getElementById("statsPlayers").innerHTML = p;
    document.getElementById("statsPairs").innerHTML = c + s;
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
