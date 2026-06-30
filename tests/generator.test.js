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

test("encodes and decodes share state", () => {
    const state = {
        s: "123",
        g: "8",
        c: "2",
        t: "18:40",
        p: PLAYER_LIST.slice(0, 2),
        a: {
            [PLAYER_LIST[0]]: {
                from: "1",
                to: "2"
            }
        }
    };
    const url = createShareUrl({ origin: "https://example.com", pathname: "/matches/" }, state);
    const hash = new URL(url).hash;

    assert.deepEqual(decodeState(hash), state);
});
