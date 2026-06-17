const assert = require("node:assert/strict");

const { PLAYER_LIST, generateSchedule } = require("../src/generator.js");
const { formatTime, formatTimeRange, parseTimeRange, isMinuteInRange } = require("../src/time.js");
const { createShareUrl, decodeState } = require("../src/share-state.js");

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

test("encodes and decodes share state", () => {
    const state = {
        s: "123",
        g: "8",
        c: "2",
        t: "18:40",
        p: PLAYER_LIST.slice(0, 2)
    };
    const url = createShareUrl({ origin: "https://example.com", pathname: "/matches/" }, state);
    const hash = new URL(url).hash;

    assert.deepEqual(decodeState(hash), state);
});
