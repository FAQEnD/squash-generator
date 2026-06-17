(function (root, factory) {
    const config =
        typeof module !== "undefined" && module.exports
            ? require("./config.js")
            : root.SquashConfig;
    const api = factory(config);

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }

    root.SquashGenerator = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (config) {
    function mulberry32(a) {
        return function () {
            a |= 0;
            a = (a + 0x6d2b79f5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function seededShuffle(arr, r) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(r() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    function scoreProjectedPlayerBalance(cand, players, playerCount) {
        const chosen = new Set(cand);
        const projectedCounts = players.map(
            player => (playerCount[player] || 0) + (chosen.has(player) ? 1 : 0)
        );
        const min = Math.min(...projectedCounts);
        const max = Math.max(...projectedCounts);
        const squaredLoad = projectedCounts.reduce((sum, count) => sum + count * count, 0);

        return (max - min) * 10000 + squaredLoad;
    }

    function pairKey(A, B) {
        return A < B ? A + "-" + B : B + "-" + A;
    }

    function resolveDisplayedPair(A, B, playerSide) {
        const sideA = playerSide[A];
        const sideB = playerSide[B];

        if (sideA && sideB) {
            if (sideA !== sideB) {
                return sideA === "left" ? [A, B] : [B, A];
            }
            return [A, B];
        }

        if (sideA) {
            return sideA === "left" ? [A, B] : [B, A];
        }

        if (sideB) {
            return sideB === "left" ? [B, A] : [A, B];
        }

        return [A, B];
    }

    function hasSideConflict(A, B, playerSide) {
        return playerSide[A] && playerSide[A] === playerSide[B];
    }

    function commitDisplayedPair(A, B, playerSide) {
        const pair = resolveDisplayedPair(A, B, playerSide);
        const left = pair[0];
        const right = pair[1];

        if (!playerSide[left]) playerSide[left] = "left";
        if (!playerSide[right]) playerSide[right] = "right";

        return pair;
    }

    function chooseBalancedPlayers(players, courts, r, playerCount) {
        const needed = courts * 2;
        let best = null;
        let bestBalanceScore = Infinity;

        for (let i = 0; i < config.PLAYER_PICK_ATTEMPTS; i++) {
            const shuffledPlayers = [...players];
            seededShuffle(shuffledPlayers, r);

            const cand = shuffledPlayers.slice(0, needed);
            const balanceScore = scoreProjectedPlayerBalance(cand, players, playerCount);

            if (balanceScore < bestBalanceScore) {
                bestBalanceScore = balanceScore;
                best = cand;
            }
        }

        return best;
    }

    function getCourtPinPriority(player, courtPinOrder) {
        const order = courtPinOrder[player];
        if (!order) return 0;

        return Math.pow(config.COURT_PIN_PRIORITY_BASE, config.PLAYER_LIST.length - order);
    }

    function scorePairOnCourt(pair, court, courtPins, courtPinOrder) {
        const leftPin = courtPins[pair[0]] || 0;
        const rightPin = courtPins[pair[1]] || 0;
        let score = 0;

        if (leftPin) {
            const priority = getCourtPinPriority(pair[0], courtPinOrder);
            score += leftPin === court ? priority : -priority;
        }

        if (rightPin) {
            const priority = getCourtPinPriority(pair[1], courtPinOrder);
            score += rightPin === court ? priority : -priority;
        }

        return score;
    }

    function getBestCourtArrangement(pairs, courtPins, courtPinOrder, courts) {
        const best = {
            score: -Infinity,
            pairs
        };

        function assign(remaining, court, placed, score) {
            if (court > courts) {
                if (score > best.score) {
                    best.score = score;
                    best.pairs = placed;
                }
                return;
            }

            for (let i = 0; i < remaining.length; i++) {
                const pair = remaining[i];
                const nextRemaining = remaining.slice(0, i).concat(remaining.slice(i + 1));
                const variants = [pair, [pair[1], pair[0]]];

                variants.forEach(variant => {
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

    function scorePairRepeat(pair, pairCount, recentPairs) {
        const A = pair[0];
        const B = pair[1];
        const key = pairKey(A, B);
        let score = 0;

        if (recentPairs.includes(key)) score += 500;
        score += (pairCount[key] || 0) * 15;

        return score;
    }

    function scorePairSideConflict(pair, playerSide) {
        return hasSideConflict(pair[0], pair[1], playerSide) ? 1 : 0;
    }

    function commitCourtPairs(pairs, playerSide) {
        return pairs.map(pair => commitDisplayedPair(pair[0], pair[1], playerSide));
    }

    function arrangePlayersIntoPairs(
        chosen,
        pairCount,
        recentPairs,
        courtPins,
        courtPinOrder,
        courts,
        playerSide
    ) {
        const best = {
            pairScore: Infinity,
            sideConflicts: Infinity,
            courtScore: -Infinity,
            pairs: []
        };

        function build(remaining, pairs) {
            if (remaining.length === 0) {
                const arrangement = getBestCourtArrangement(
                    pairs,
                    courtPins,
                    courtPinOrder,
                    courts
                );
                const pairScore = pairs.reduce(
                    (sum, pair) => sum + scorePairRepeat(pair, pairCount, recentPairs),
                    0
                );
                const sideConflicts = pairs.reduce(
                    (sum, pair) => sum + scorePairSideConflict(pair, playerSide),
                    0
                );

                if (
                    pairScore < best.pairScore ||
                    (pairScore === best.pairScore && sideConflicts < best.sideConflicts) ||
                    (pairScore === best.pairScore &&
                        sideConflicts === best.sideConflicts &&
                        arrangement.score > best.courtScore)
                ) {
                    best.pairScore = pairScore;
                    best.sideConflicts = sideConflicts;
                    best.courtScore = arrangement.score;
                    best.pairs = arrangement.pairs;
                }
                return;
            }

            const first = remaining[0];
            for (let i = 1; i < remaining.length; i++) {
                const pair = [first, remaining[i]];
                const nextRemaining = remaining.slice(1, i).concat(remaining.slice(i + 1));

                build(nextRemaining, pairs.concat([pair]));
            }
        }

        build(chosen, []);
        return best.pairs;
    }

    function assignNewCourtPins(pairs, courtPins, courtPinOrder, nextCourtPinOrder) {
        pairs.forEach((pair, index) => {
            const court = index + 1;
            pair.forEach(player => {
                if (!courtPins[player]) {
                    courtPins[player] = court;
                    courtPinOrder[player] = nextCourtPinOrder.value;
                    nextCourtPinOrder.value++;
                }
            });
        });
    }

    function generateSchedule(options) {
        const seed = parseInt(options.seed, 10) || 1;
        const r = mulberry32(seed);

        const games = +options.games;
        const courts = +options.courts;
        const players = [...options.players];
        const avoidN = options.avoidN || config.DEFAULT_AVOID_RECENT_ROUNDS;

        if (players.length < courts * 2) {
            throw new Error("Замало гравців!");
        }

        const pairCount = {};
        const playerCount = {};
        const courtPins = {};
        const courtPinOrder = {};
        const nextCourtPinOrder = { value: 1 };
        const playerSide = {};
        players.forEach(p => (playerCount[p] = 0));

        const recentPairs = [];
        const results = [];

        for (let g = 1; g <= games; g++) {
            const chosen = chooseBalancedPlayers(players, courts, r, playerCount);

            const used = new Set(chosen);
            const rest = players.filter(p => !used.has(p));

            let pairs = arrangePlayersIntoPairs(
                chosen,
                pairCount,
                recentPairs,
                courtPins,
                courtPinOrder,
                courts,
                playerSide
            );

            pairs = commitCourtPairs(pairs, playerSide);

            pairs.forEach(pair => {
                const A = pair[0];
                const B = pair[1];
                const key = pairKey(A, B);

                pairCount[key] = (pairCount[key] || 0) + 1;
                recentPairs.push(key);

                playerCount[A]++;
                playerCount[B]++;
            });

            assignNewCourtPins(pairs, courtPins, courtPinOrder, nextCourtPinOrder);

            while (recentPairs.length > avoidN * courts) {
                recentPairs.shift();
            }

            results.push({ game: g, pairs, rest });
        }

        return {
            results,
            pairCount,
            playerCount,
            courtPins,
            courtPinOrder
        };
    }

    return {
        PLAYER_LIST: config.PLAYER_LIST,
        generateSchedule
    };
});
