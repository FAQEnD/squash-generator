const assert = require("node:assert/strict");

const { PLAYER_LIST, generateSchedule } = require("../src/generator.js");
const config = require("../src/config.js");
const { formatTime, formatTimeRange, parseTimeRange, isMinuteInRange } = require("../src/time.js");
const { createShareUrl, decodeState } = require("../src/share-state.js");
const ui = require("../src/ui.js");

const NINE_PLAYERS = PLAYER_LIST.slice(0, 9);

function pairKey(pair) {
    const [a, b] = pair;
    return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function getCourtPairsByPlayer(game) {
    const map = {};
    game.pairs.forEach((pair, index) => {
        const court = index + 1;
        pair.forEach(player => {
            map[player] = {
                court,
                pair
            };
        });
    });
    return map;
}

function assertBalancedGames(schedule) {
    const counts = Object.values(schedule.playerCount);
    assert.ok(
        Math.max(...counts) - Math.min(...counts) <= 1,
        `game counts are not balanced: ${JSON.stringify(schedule.playerCount)}`
    );
}

function assertNoDuplicatePlayersInGame(schedule) {
    schedule.results.forEach(game => {
        const playing = game.pairs.flat();
        assert.equal(
            new Set(playing).size,
            playing.length,
            `game ${game.game} has duplicate players`
        );
    });
}

function assertCourtCount(schedule, courts) {
    schedule.results.forEach(game => {
        assert.equal(game.pairs.length, courts, `game ${game.game} has wrong court count`);
    });
}

function getGamesForPlayer(schedule, player) {
    return schedule.results
        .filter(game => game.pairs.flat().includes(player))
        .map(game => game.game);
}

function getSoloCourt(game) {
    const index = game.pairs.findIndex(pair => pair.length === 1);
    return index === -1 ? null : index + 1;
}

function getSoloPlayer(game) {
    const pair = game.pairs.find(pair => pair.length === 1);
    return pair ? pair[0] : null;
}

function assertPinnedPlayersUseCourtUnlessBlockedByStrongerPin(schedule) {
    schedule.results.forEach(game => {
        const playersByCourt = getCourtPairsByPlayer(game);

        Object.entries(playersByCourt).forEach(([player, placement]) => {
            const pinnedCourt = schedule.courtPins[player];
            const playerOrder = schedule.courtPinOrder[player];

            if (!pinnedCourt || placement.court === pinnedCourt) return;

            const partner = placement.pair.find(p => p !== player);
            const partnerOrder = schedule.courtPinOrder[partner];
            const partnerHasStrongerPinOnActualCourt =
                schedule.courtPins[partner] === placement.court && partnerOrder < playerOrder;

            const targetCourtPair = game.pairs[pinnedCourt - 1] || [];
            const targetCourtHasStrongerPinnedPlayer = targetCourtPair.some(
                other =>
                    schedule.courtPins[other] === pinnedCourt &&
                    schedule.courtPinOrder[other] < playerOrder
            );

            assert.ok(
                partnerHasStrongerPinOnActualCourt || targetCourtHasStrongerPinnedPlayer,
                `${player} was on court ${placement.court}, pinned to court ${pinnedCourt}, without a stronger pin conflict`
            );
        });
    });
}

function assertPairRepeatsDoNotGrowNeedlessly(schedule, players, games, courts) {
    const pairSlots = games * courts;
    const possiblePairs = (players.length * (players.length - 1)) / 2;
    const maxPairCount = Math.max(...Object.values(schedule.pairCount));

    if (possiblePairs >= pairSlots) {
        assert.equal(
            maxPairCount,
            1,
            `pairs repeated even though ${possiblePairs} unique pairs are available for ${pairSlots} pair slots`
        );
        return;
    }

    assert.ok(
        maxPairCount <= Math.ceil(pairSlots / possiblePairs),
        `pair repeats exceed the unavoidable lower bound: ${JSON.stringify(schedule.pairCount)}`
    );
}

function assertScheduleInvariants({ players, games, courts, seed }) {
    const schedule = generateSchedule({
        players,
        games,
        courts,
        seed
    });

    assertBalancedGames(schedule);
    assertNoDuplicatePlayersInGame(schedule);
    assertCourtCount(schedule, courts);
    assertPinnedPlayersUseCourtUnlessBlockedByStrongerPin(schedule);
    assertPairRepeatsDoNotGrowNeedlessly(schedule, players, games, courts);

    return schedule;
}

function test(name, fn) {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        throw error;
    }
}

class FakeClassList {
    constructor(element) {
        this.element = element;
        this.classes = new Set();
    }

    add(value) {
        this.classes.add(value);
        this.sync();
    }

    remove(value) {
        this.classes.delete(value);
        this.sync();
    }

    contains(value) {
        return this.classes.has(value);
    }

    toggle(value, force) {
        const shouldAdd = force === undefined ? !this.classes.has(value) : force;
        if (shouldAdd) {
            this.classes.add(value);
        } else {
            this.classes.delete(value);
        }
        this.sync();
        return shouldAdd;
    }

    setFromString(value) {
        this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
    }

    sync() {
        this.element._className = [...this.classes].join(" ");
    }
}

class FakeElement {
    constructor(tagName, ownerDocument) {
        this.tagName = tagName.toUpperCase();
        this.ownerDocument = ownerDocument;
        this.children = [];
        this.parentNode = null;
        this.attributes = {};
        this.classList = new FakeClassList(this);
        this._className = "";
        this._textContent = "";
        this.value = "";
        this.eventListeners = {};
        this.dataset = {};
        this.hidden = false;
        this.scrollIntoViewCalled = false;
    }

    set id(value) {
        this.attributes.id = value;
        this.ownerDocument.registerElement(value, this);
    }

    get id() {
        return this.attributes.id || "";
    }

    set className(value) {
        this._className = value;
        this.classList.setFromString(value);
    }

    get className() {
        return this._className;
    }

    set textContent(value) {
        this._textContent = String(value);
        this.children = [];
    }

    get textContent() {
        return this.children.length
            ? this.children.map(child => child.textContent).join("")
            : this._textContent;
    }

    get innerText() {
        return this.textContent;
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    getAttribute(name) {
        return this.attributes[name];
    }

    addEventListener(type, listener) {
        this.eventListeners[type] = this.eventListeners[type] || [];
        this.eventListeners[type].push(listener);
    }

    click() {
        (this.eventListeners.click || []).forEach(listener => listener());
    }

    scrollIntoView() {
        this.scrollIntoViewCalled = true;
    }

    append(...nodes) {
        nodes.forEach(node => {
            node.parentNode = this;
            this.children.push(node);
        });
    }

    replaceChildren(...nodes) {
        this.children = [];
        this.append(...nodes);
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
        return queryFrom(this, selector);
    }
}

class FakeDocument {
    constructor() {
        this.elementsById = {};
        this.body = this.createElement("body");
    }

    createElement(tagName) {
        return new FakeElement(tagName, this);
    }

    createDocumentFragment() {
        return this.createElement("fragment");
    }

    registerElement(id, element) {
        this.elementsById[id] = element;
    }

    getElementById(id) {
        return this.elementsById[id] || null;
    }

    querySelector(selector) {
        return this.body.querySelector(selector);
    }

    querySelectorAll(selector) {
        return this.body.querySelectorAll(selector);
    }
}

function queryFrom(root, selector) {
    if (selector.includes(",")) {
        return selector
            .split(",")
            .flatMap(part => queryFrom(root, part.trim()))
            .filter((element, index, all) => all.indexOf(element) === index);
    }

    if (selector === "#tableBox table") {
        const tableBox = root.ownerDocument.getElementById("tableBox");
        return tableBox ? descendants(tableBox).filter(el => el.tagName === "TABLE") : [];
    }

    if (selector === ".player-schedule-list li") {
        return descendants(root).filter(
            el => el.tagName === "LI" && hasAncestorWithClass(el, "player-schedule-list")
        );
    }

    if (selector === ".payment-list li") {
        return descendants(root).filter(
            el => el.tagName === "LI" && hasAncestorWithClass(el, "payment-list")
        );
    }

    if (selector === ".schedule-time") {
        return descendants(root).filter(el => el.classList.contains("schedule-time"));
    }

    if (selector === "#tableBox tr.current-game") {
        const tableBox = root.ownerDocument.getElementById("tableBox");
        return tableBox
            ? descendants(tableBox).filter(
                  el => el.tagName === "TR" && el.classList.contains("current-game")
              )
            : [];
    }

    if (/^[a-z]+$/i.test(selector)) {
        return descendants(root).filter(el => el.tagName === selector.toUpperCase());
    }

    if (/^\.[\w-]+$/.test(selector)) {
        const className = selector.slice(1);
        return descendants(root).filter(el => el.classList.contains(className));
    }

    return [];
}

function descendants(root) {
    return root.children.flatMap(child => [child].concat(descendants(child)));
}

function hasAncestorWithClass(element, className) {
    let current = element.parentNode;
    while (current) {
        if (current.classList.contains(className)) return true;
        current = current.parentNode;
    }
    return false;
}

function appendRoot(document, id, value = "") {
    const element = document.createElement("div");
    element.id = id;
    element.value = value;
    document.body.append(element);
    return element;
}

function appendRootElement(document, tagName, id, className = "") {
    const element = document.createElement(tagName);
    element.id = id;
    element.className = className;
    document.body.append(element);
    return element;
}

function setupReadonlyShell(document) {
    appendRootElement(document, "header", "header");
    const main = appendRootElement(document, "main", "main");

    ["playersTitle", "players", "settingsTitle", "statsTitle", "statsBox", "tableBox"].forEach(
        id => {
            const element = document.createElement("div");
            element.id = id;
            main.append(element);
        }
    );

    const controls = document.createElement("div");
    controls.className = "controls";
    main.append(controls);

    const row = document.createElement("div");
    row.className = "row";
    main.append(row);

    const playerScheduleBox = document.createElement("section");
    playerScheduleBox.id = "playerScheduleBox";
    playerScheduleBox.className = "readonly-hidden";
    main.append(playerScheduleBox);

    const playerToggle = document.createElement("button");
    playerToggle.id = "playerScheduleToggle";
    playerScheduleBox.append(playerToggle);

    const playerContent = document.createElement("div");
    playerContent.id = "playerScheduleContent";
    playerScheduleBox.append(playerContent);

    const playerSelect = document.createElement("select");
    playerSelect.id = "playerScheduleSelect";
    playerContent.append(playerSelect);

    const showPaymentButton = document.createElement("button");
    showPaymentButton.id = "showPaymentBtn";
    playerContent.append(showPaymentButton);

    const resultsSection = document.createElement("section");
    resultsSection.id = "resultsSection";
    main.append(resultsSection);

    const resultsToggle = document.createElement("button");
    resultsToggle.id = "resultsToggle";
    resultsSection.append(resultsToggle);

    const resultsContent = document.createElement("div");
    resultsContent.id = "resultsContent";
    resultsSection.append(resultsContent);

    const paymentSection = document.createElement("section");
    paymentSection.id = "paymentSection";
    paymentSection.className = "readonly-hidden";
    main.append(paymentSection);

    const paymentToggle = document.createElement("button");
    paymentToggle.id = "paymentToggle";
    paymentSection.append(paymentToggle);

    const paymentContent = document.createElement("div");
    paymentContent.id = "paymentContent";
    paymentContent.hidden = true;
    paymentSection.append(paymentContent);

    const paymentBox = document.createElement("div");
    paymentBox.id = "paymentBox";
    paymentContent.append(paymentBox);

    config.PLAYER_LIST.forEach(player => {
        const checkbox = document.createElement("input");
        checkbox.id = "p_" + player;
        checkbox.checked = config.DEFAULT_SELECTED.has(player);
        main.append(checkbox);
    });

    return {
        main,
        playerContent,
        resultsToggle,
        resultsContent,
        paymentSection,
        paymentToggle,
        paymentContent,
        showPaymentButton
    };
}

function withFakeDate(isoDate, fn) {
    const RealDate = global.Date;
    global.Date = class extends RealDate {
        constructor(...args) {
            if (args.length === 0) return new RealDate(isoDate);
            return new RealDate(...args);
        }

        static now() {
            return new RealDate(isoDate).getTime();
        }
    };

    try {
        fn();
    } finally {
        global.Date = RealDate;
    }
}

function withFakeDocument(fn) {
    const realDocument = global.document;
    const document = new FakeDocument();
    global.document = document;

    try {
        fn(document);
    } finally {
        global.document = realDocument;
    }
}

test("keeps balance and court pins for seed 881378971", () => {
    assertScheduleInvariants({
        players: NINE_PLAYERS,
        games: 8,
        courts: 4,
        seed: 881378971
    });
});

test("keeps balance and court pins for seed 538447038", () => {
    assertScheduleInvariants({
        players: NINE_PLAYERS,
        games: 8,
        courts: 4,
        seed: 538447038
    });
});

test("keeps invariants when all players are selected", () => {
    assertScheduleInvariants({
        players: PLAYER_LIST,
        games: 8,
        courts: 4,
        seed: 881378971
    });
});

test("honors player availability by game range", () => {
    const limitedPlayer = NINE_PLAYERS[0];
    const schedule = generateSchedule({
        players: NINE_PLAYERS,
        games: 8,
        courts: 2,
        seed: 123,
        playerAvailability: {
            [limitedPlayer]: {
                from: 3,
                to: 6
            }
        }
    });
    const playedGames = getGamesForPlayer(schedule, limitedPlayer);

    assert.ok(playedGames.length > 0);
    playedGames.forEach(game => {
        assert.ok(game >= 3 && game <= 6, `${limitedPlayer} played outside availability`);
    });
    assertNoDuplicatePlayersInGame(schedule);
    assertCourtCount(schedule, 2);
});

test("limited players can rest inside their availability range", () => {
    const limitedPlayer = NINE_PLAYERS[0];
    const schedule = generateSchedule({
        players: NINE_PLAYERS.slice(0, 5),
        games: 8,
        courts: 2,
        seed: 123,
        playerAvailability: {
            [limitedPlayer]: {
                from: 1,
                to: 4
            }
        }
    });
    const restedWhileAvailable = schedule.results
        .slice(0, 4)
        .some(game => game.rest.includes(limitedPlayer));

    assert.equal(restedWhileAvailable, true);
    assert.equal(
        getGamesForPlayer(schedule, limitedPlayer).some(game => game > 4),
        false
    );
});

test("keeps generating when a game has only enough players for a single", () => {
    const schedule = generateSchedule({
        players: NINE_PLAYERS.slice(0, 4),
        games: 3,
        courts: 2,
        seed: 123,
        playerAvailability: {
            [NINE_PLAYERS[0]]: {
                from: 2,
                to: 3
            }
        }
    });

    assertCourtCount(schedule, 2);
    assert.deepEqual(schedule.results[0].pairs.map(pair => pair.length).sort(), [1, 2]);
    assertNoDuplicatePlayersInGame(schedule);
});

test("keeps solo players on the same court after the first solo slot", () => {
    const schedule = generateSchedule({
        players: NINE_PLAYERS.slice(0, 4),
        games: 3,
        courts: 2,
        seed: 123,
        playerAvailability: {
            [NINE_PLAYERS[0]]: {
                from: 2,
                to: 2
            }
        }
    });

    const soloCourts = schedule.results.map(getSoloCourt).filter(Boolean);
    assert.deepEqual(soloCourts, [soloCourts[0], soloCourts[0]]);
});

test("resting players only include players available for that game", () => {
    const unavailableAfterFirstGame = NINE_PLAYERS[0];
    const schedule = generateSchedule({
        players: NINE_PLAYERS.slice(0, 6),
        games: 3,
        courts: 2,
        seed: 123,
        playerAvailability: {
            [unavailableAfterFirstGame]: {
                from: 1,
                to: 1
            }
        }
    });

    assert.equal(schedule.results[1].rest.includes(unavailableAfterFirstGame), false);
    assert.equal(schedule.results[2].rest.includes(unavailableAfterFirstGame), false);
});

test("rotates solo players after limited players leave", () => {
    const players = NINE_PLAYERS.slice(0, 5);
    const schedule = generateSchedule({
        players,
        games: 8,
        courts: 2,
        seed: 123,
        playerAvailability: {
            [players[0]]: {
                from: 1,
                to: 4
            },
            [players[1]]: {
                from: 1,
                to: 4
            }
        }
    });
    const lateGames = schedule.results.slice(4);
    const soloCourts = lateGames.map(getSoloCourt);
    const soloPlayers = lateGames.map(getSoloPlayer);

    assert.deepEqual(soloCourts, [soloCourts[0], soloCourts[0], soloCourts[0], soloCourts[0]]);
    assert.ok(new Set(soloPlayers).size > 1, `solo players did not rotate: ${soloPlayers}`);
    lateGames.forEach(game => {
        assert.equal(game.rest.length, 0);
        assert.equal(game.pairs.flat().includes(players[0]), false);
        assert.equal(game.pairs.flat().includes(players[1]), false);
    });
});

test("keeps generating with empty courts when too few players are selected", () => {
    const schedule = generateSchedule({
        players: NINE_PLAYERS.slice(0, 1),
        games: 2,
        courts: 2,
        seed: 123
    });

    assertCourtCount(schedule, 2);
    assert.deepEqual(schedule.results[0].pairs.map(pair => pair.length).sort(), [0, 1]);
    assert.deepEqual(schedule.playerCount, {
        [NINE_PLAYERS[0]]: 2
    });
});

test("uses the full schedule when player availability is omitted", () => {
    assertScheduleInvariants({
        players: NINE_PLAYERS,
        games: 8,
        courts: 4,
        seed: 881378971
    });
});

test("formats and parses time ranges", () => {
    assert.equal(formatTime(18 * 60 + 40), "18:40");
    assert.equal(formatTimeRange(18 * 60 + 40, 10), "18:40–18:50");

    const range = parseTimeRange("18:40–18:50");
    assert.deepEqual(range, {
        start: 18 * 60 + 40,
        end: 18 * 60 + 50
    });
    assert.equal(isMinuteInRange(18 * 60 + 45, range), true);
    assert.equal(isMinuteInRange(18 * 60 + 50, range), false);
});

test("normalizes custom court labels", () => {
    assert.deepEqual(ui.normalizeCourtLabels("2, 3, 4", 3), ["2", "3", "4"]);
    assert.deepEqual(ui.normalizeCourtLabels("", 3), ["1", "2", "3"]);
    assert.deepEqual(ui.normalizeCourtLabels("2, 3, 4, 5", 3), ["2", "3", "4"]);
    assert.deepEqual(ui.normalizeCourtLabels("2", 3), ["2", "2", "3"]);
    assert.deepEqual(ui.normalizeCourtLabels(" 2, , 4 ", 3), ["2", "4", "3"]);
});

test("encodes and decodes share state", () => {
    const state = {
        s: "123",
        g: "8",
        c: "2",
        cl: "2, 3",
        t: "18:40",
        p: PLAYER_LIST.slice(0, 2),
        a: {
            [PLAYER_LIST[0]]: {
                from: "1",
                to: "2"
            }
        },
        pay: "4444 1111 2222 3333",
        cost: "1200"
    };
    const url = createShareUrl({ origin: "https://example.com", pathname: "/matches/" }, state);
    const hash = new URL(url).hash;

    assert.deepEqual(decodeState(hash), state);
});

test("renders table with custom court labels", () => {
    withFakeDocument(document => {
        appendRoot(document, "startTime", "18:40");
        const tableBox = appendRoot(document, "tableBox");

        ui.renderTable(
            [
                {
                    game: 1,
                    pairs: [["Anton"], ["Nazar"], ["Ira"]],
                    rest: []
                }
            ],
            3,
            ["2", "3", "4"]
        );

        const headers = descendants(tableBox)
            .filter(el => el.tagName === "TH")
            .map(el => el.innerText);

        assert.deepEqual(headers, ["Час", "Корт 2", "Корт 3", "Корт 4", "Відпочивають"]);
    });
});

test("renders court pin stats with custom court labels", () => {
    withFakeDocument(document => {
        appendRoot(document, "statsPlayers");
        const statsPairs = appendRoot(document, "statsPairs");

        ui.renderStats({ Anton: 1 }, {}, { Anton: 2 }, { Anton: 1 }, ["2", "4"]);

        assert.equal(statsPairs.innerText.includes("Корт 4 (#1)"), true);
    });
});

test("recognizes and normalizes card payment targets", () => {
    assert.deepEqual(ui.normalizePaymentTarget("4444 1111-2222 3333"), {
        type: "card",
        value: "4444111122223333",
        label: "4444 1111 2222 3333"
    });
});

test("recognizes monobank payment links", () => {
    assert.deepEqual(ui.normalizePaymentTarget("https://send.monobank.ua/jar/example"), {
        type: "mono",
        value: "https://send.monobank.ua/jar/example",
        label: "Monobank"
    });
});

test("rejects invalid payment targets", () => {
    assert.equal(ui.normalizePaymentTarget("not a payment target"), null);
    assert.equal(ui.normalizePaymentTarget("12345"), null);
    assert.equal(ui.normalizePaymentTarget("http://send.monobank.ua/jar/example"), null);
});

test("counts payment availability inside schedule bounds", () => {
    assert.equal(ui.countAvailableGames({ from: "0", to: "99" }, 8), 8);
    assert.equal(ui.countAvailableGames({ from: "3", to: "6" }, 8), 4);
    assert.equal(ui.countAvailableGames({ from: "7", to: "3" }, 8), 0);
});

test("defaults rental cost from court count when no cost is provided", () => {
    assert.equal(ui.getDefaultRentalCost(2), 1200);
    assert.equal(ui.getDefaultRentalCost("3"), 1800);
    assert.equal(ui.resolveRentalCost("", 4), "2400");
    assert.equal(ui.resolveRentalCost("1000", 4), "1000");
});

test("shows default rental cost as the input placeholder", () => {
    withFakeDocument(document => {
        appendRoot(document, "courts", "3");
        const rentalCost = appendRoot(document, "rentalCost");

        ui.syncRentalCostPlaceholder();

        assert.equal(rentalCost.placeholder, "1800");
    });
});

test("calculates payment shares from availability and rounds up", () => {
    const players = PLAYER_LIST.slice(0, 3);
    const shares = ui.calculatePaymentShares(
        players,
        {
            [players[0]]: {
                from: "1",
                to: "3"
            },
            [players[1]]: {
                from: "1",
                to: "1"
            },
            [players[2]]: {
                from: "2",
                to: "3"
            }
        },
        3,
        "100"
    );

    assert.deepEqual(shares, [
        {
            player: players[0],
            games: 3,
            amount: 50
        },
        {
            player: players[1],
            games: 1,
            amount: 17
        },
        {
            player: players[2],
            games: 2,
            amount: 34
        }
    ]);
});

test("renders readonly payment summary for a valid card", () => {
    withFakeDocument(document => {
        const paymentBox = appendRoot(document, "paymentBox");
        const players = PLAYER_LIST.slice(0, 2);

        ui.renderPaymentSummary({
            players,
            games: 4,
            playerAvailability: {
                [players[0]]: {
                    from: "1",
                    to: "4"
                },
                [players[1]]: {
                    from: "1",
                    to: "2"
                }
            },
            paymentTarget: "4444 1111 2222 3333",
            rentalCost: "600"
        });

        const copyButton = descendants(paymentBox).find(el =>
            el.classList.contains("payment-copy")
        );
        const rows = descendants(paymentBox).filter(el => el.tagName === "LI");

        assert.equal(paymentBox.classList.contains("readonly-hidden"), false);
        assert.ok(copyButton);
        assert.equal(copyButton.textContent, "4444 1111 2222 3333");
        assert.equal(rows.length, 2);
        assert.equal(rows[0].innerText.includes("400 грн"), true);
        assert.equal(rows[1].innerText.includes("200 грн"), true);
    });
});

test("renders readonly payment summary for a monobank link", () => {
    withFakeDocument(document => {
        const paymentBox = appendRoot(document, "paymentBox");

        ui.renderPaymentSummary({
            players: PLAYER_LIST.slice(0, 1),
            games: 1,
            playerAvailability: {},
            paymentTarget: "https://send.monobank.ua/jar/example",
            rentalCost: "100"
        });

        const link = descendants(paymentBox).find(el => el.classList.contains("payment-link"));

        assert.equal(paymentBox.classList.contains("readonly-hidden"), false);
        assert.ok(link);
        assert.equal(link.href, "https://send.monobank.ua/jar/example");
        assert.equal(link.textContent, "Monobank");
    });
});

test("renders readonly payment summary without valid payment details", () => {
    withFakeDocument(document => {
        const paymentBox = appendRoot(document, "paymentBox");
        const paymentSection = appendRoot(document, "paymentSection");
        const showPaymentButton = appendRoot(document, "showPaymentBtn");

        ui.renderPaymentSummary({
            players: PLAYER_LIST.slice(0, 1),
            games: 1,
            playerAvailability: {},
            paymentTarget: "not valid",
            rentalCost: "100"
        });

        const paymentTarget = descendants(paymentBox).find(el =>
            el.classList.contains("payment-target")
        );
        const rows = descendants(paymentBox).filter(el => el.tagName === "LI");

        assert.equal(paymentBox.classList.contains("readonly-hidden"), false);
        assert.equal(paymentSection.classList.contains("readonly-hidden"), false);
        assert.equal(showPaymentButton.classList.contains("readonly-hidden"), false);
        assert.equal(paymentTarget, undefined);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].innerText.includes("100"), true);
    });
});

test("hides readonly payment summary without a cost", () => {
    withFakeDocument(document => {
        const paymentBox = appendRoot(document, "paymentBox");
        const paymentSection = appendRoot(document, "paymentSection");
        const showPaymentButton = appendRoot(document, "showPaymentBtn");

        ui.renderPaymentSummary({
            players: PLAYER_LIST.slice(0, 1),
            games: 1,
            playerAvailability: {},
            paymentTarget: "4444 1111 2222 3333",
            rentalCost: ""
        });

        assert.equal(paymentBox.classList.contains("readonly-hidden"), true);
        assert.equal(paymentSection.classList.contains("readonly-hidden"), true);
        assert.equal(showPaymentButton.classList.contains("readonly-hidden"), true);
        assert.equal(paymentBox.children.length, 0);
    });
});

test("readonly mode opens personal schedule and collapses results and payment", () => {
    withFakeDocument(document => {
        const shell = setupReadonlyShell(document);

        ui.renderPaymentSummary({
            players: PLAYER_LIST.slice(0, 1),
            games: 1,
            playerAvailability: {},
            paymentTarget: "4444 1111 2222 3333",
            rentalCost: "100"
        });
        ui.applyReadonlyMode(true);

        assert.equal(shell.main.classList.contains("readonly-main"), true);
        assert.equal(
            document.getElementById("playerScheduleBox").classList.contains("readonly-hidden"),
            false
        );
        assert.equal(
            document.getElementById("playerScheduleToggle").getAttribute("aria-expanded"),
            "true"
        );
        assert.equal(shell.playerContent.hidden, false);
        assert.equal(shell.resultsToggle.getAttribute("aria-expanded"), "false");
        assert.equal(shell.resultsContent.hidden, true);
        assert.equal(shell.paymentSection.classList.contains("readonly-hidden"), false);
        assert.equal(shell.paymentToggle.getAttribute("aria-expanded"), "false");
        assert.equal(shell.paymentContent.hidden, true);
    });
});

test("admin mode does not bind shared accordion toggles", () => {
    withFakeDocument(document => {
        const shell = setupReadonlyShell(document);

        shell.resultsToggle.click();

        assert.equal(shell.main.classList.contains("readonly-main"), false);
        assert.equal(shell.resultsToggle.getAttribute("aria-expanded"), undefined);
        assert.equal(shell.resultsContent.hidden, false);
    });
});

test("valid admin payment opens payment content", () => {
    withFakeDocument(document => {
        const shell = setupReadonlyShell(document);

        ui.renderPaymentSummary({
            players: PLAYER_LIST.slice(0, 1),
            games: 1,
            playerAvailability: {},
            paymentTarget: "4444 1111 2222 3333",
            rentalCost: "100"
        });

        assert.equal(shell.paymentSection.classList.contains("readonly-hidden"), false);
        assert.equal(shell.paymentContent.hidden, false);
    });
});

test("shared section toggle updates expanded state", () => {
    withFakeDocument(document => {
        const shell = setupReadonlyShell(document);

        ui.applyReadonlyMode(true);
        shell.resultsToggle.click();

        assert.equal(shell.resultsToggle.getAttribute("aria-expanded"), "true");
        assert.equal(shell.resultsContent.hidden, false);

        shell.resultsToggle.click();

        assert.equal(shell.resultsToggle.getAttribute("aria-expanded"), "false");
        assert.equal(shell.resultsContent.hidden, true);
    });
});

test("payment jump opens payment section and scrolls to it", () => {
    withFakeDocument(document => {
        const shell = setupReadonlyShell(document);

        ui.renderPaymentSummary({
            players: PLAYER_LIST.slice(0, 1),
            games: 1,
            playerAvailability: {},
            paymentTarget: "https://send.monobank.ua/jar/example",
            rentalCost: "100"
        });
        ui.applyReadonlyMode(true);
        shell.showPaymentButton.click();

        assert.equal(shell.paymentToggle.getAttribute("aria-expanded"), "true");
        assert.equal(shell.paymentContent.hidden, false);
        assert.equal(shell.paymentSection.scrollIntoViewCalled, true);
    });
});

test("highlights selected player in the payment list", () => {
    withFakeDocument(document => {
        appendRoot(document, "startTime", "18:40");
        appendRoot(document, "tableBox");
        appendRoot(document, "playerScheduleResult");
        const paymentBox = appendRoot(document, "paymentBox");
        const players = ["Anton", "Nazar"];

        ui.renderTable(
            [
                {
                    game: 1,
                    pairs: [["Anton", "Nazar"]],
                    rest: []
                }
            ],
            1
        );
        ui.renderPaymentSummary({
            players,
            games: 1,
            playerAvailability: {},
            paymentTarget: "4444 1111 2222 3333",
            rentalCost: "200"
        });
        ui.renderPlayerSchedule("Nazar");

        const rows = descendants(paymentBox).filter(el => el.tagName === "LI");

        assert.equal(rows[0].classList.contains("payment-player-active"), false);
        assert.equal(rows[1].classList.contains("payment-player-active"), true);
    });
});

test("keeps selected payment highlight after payment rerender", () => {
    withFakeDocument(document => {
        appendRoot(document, "startTime", "18:40");
        appendRoot(document, "tableBox");
        appendRoot(document, "playerScheduleResult");
        const paymentBox = appendRoot(document, "paymentBox");
        const players = ["Anton", "Nazar"];

        ui.renderTable(
            [
                {
                    game: 1,
                    pairs: [["Anton", "Nazar"]],
                    rest: []
                }
            ],
            1
        );
        ui.renderPaymentSummary({
            players,
            games: 1,
            playerAvailability: {},
            paymentTarget: "4444 1111 2222 3333",
            rentalCost: "200"
        });
        ui.renderPlayerSchedule("Nazar");
        ui.renderPaymentSummary({
            players,
            games: 1,
            playerAvailability: {},
            paymentTarget: "4444 1111 2222 3333",
            rentalCost: "300"
        });

        const rows = descendants(paymentBox).filter(el => el.tagName === "LI");

        assert.equal(rows[1].classList.contains("payment-player-active"), true);
    });
});

test("moves payment highlight when another player is selected", () => {
    withFakeDocument(document => {
        appendRoot(document, "startTime", "18:40");
        appendRoot(document, "tableBox");
        appendRoot(document, "playerScheduleResult");
        const paymentBox = appendRoot(document, "paymentBox");
        const players = ["Anton", "Nazar"];

        ui.renderTable(
            [
                {
                    game: 1,
                    pairs: [["Anton", "Nazar"]],
                    rest: []
                }
            ],
            1
        );
        ui.renderPaymentSummary({
            players,
            games: 1,
            playerAvailability: {},
            paymentTarget: "4444 1111 2222 3333",
            rentalCost: "200"
        });
        ui.renderPlayerSchedule("Nazar");
        ui.renderPlayerSchedule("Anton");

        const rows = descendants(paymentBox).filter(el => el.tagName === "LI");

        assert.equal(rows[0].classList.contains("payment-player-active"), true);
        assert.equal(rows[1].classList.contains("payment-player-active"), false);
    });
});

test("renders player schedule with custom court labels", () => {
    withFakeDocument(document => {
        appendRoot(document, "startTime", "18:40");
        appendRoot(document, "tableBox");
        appendRoot(document, "playerScheduleResult");

        ui.renderTable(
            [
                {
                    game: 1,
                    pairs: [
                        ["Anton", "Olek"],
                        ["Yulia", "Ira"]
                    ],
                    rest: []
                }
            ],
            2,
            ["2", "4"]
        );
        ui.renderPlayerSchedule("Ira");

        const personalRows = document.querySelectorAll(".player-schedule-list li");

        assert.equal(personalRows.length, 1);
        assert.equal(personalRows[0].innerText.includes("Корт 4"), true);
    });
});

test("selecting a player without a payment row does not fail", () => {
    withFakeDocument(document => {
        appendRoot(document, "startTime", "18:40");
        appendRoot(document, "tableBox");
        appendRoot(document, "playerScheduleResult");
        const paymentBox = appendRoot(document, "paymentBox");

        ui.renderTable(
            [
                {
                    game: 1,
                    pairs: [["Anton", "Nazar"]],
                    rest: []
                }
            ],
            1
        );
        ui.renderPaymentSummary({
            players: ["Anton"],
            games: 1,
            playerAvailability: {},
            paymentTarget: "4444 1111 2222 3333",
            rentalCost: "100"
        });
        ui.renderPlayerSchedule("Nazar");

        const rows = descendants(paymentBox).filter(el => el.tagName === "LI");

        assert.equal(rows.length, 1);
        assert.equal(rows[0].classList.contains("payment-player-active"), false);
    });
});

test("renders player schedule with rest rows and highlights the current slot", () => {
    withFakeDocument(document => {
        appendRoot(document, "startTime", "18:40");
        appendRoot(document, "tableBox");
        appendRoot(document, "playerScheduleResult");

        ui.renderTable(
            [
                {
                    game: 1,
                    pairs: [
                        ["Anton", "Olek"],
                        ["Yulia", "Ira"]
                    ],
                    rest: ["Nazar"]
                },
                {
                    game: 2,
                    pairs: [
                        ["Anton", "Nazar"],
                        ["Olek", "Yulia"]
                    ],
                    rest: ["Ira"]
                }
            ],
            2
        );

        withFakeDate("2026-06-30T18:45:00", () => {
            ui.renderPlayerSchedule("Nazar");
        });

        const personalRows = document.querySelectorAll(".player-schedule-list li");
        const currentPersonalRows = personalRows.filter(row =>
            row.classList.contains("current-game")
        );
        const currentGeneralRows = document.querySelectorAll("#tableBox tr.current-game");

        assert.equal(personalRows.length, 2);
        assert.equal(currentPersonalRows.length, 1);
        assert.equal(currentGeneralRows.length, 1);
        assert.equal(personalRows[0].innerText.includes("Відпочинок"), true);
        assert.equal(personalRows[0].innerText.includes("Корт"), false);
        assert.equal(personalRows[0].classList.contains("current-game"), true);
        assert.equal(personalRows[1].innerText.includes("Корт 1"), true);
        assert.equal(personalRows[1].innerText.includes("з Anton"), true);
    });
});
