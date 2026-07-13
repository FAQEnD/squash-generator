(function (root, factory) {
    const api = factory();

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }

    root.SquashConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const PLAYER_LIST = [
        "Антон",
        "Іра",
        "Олександр",
        "Юля",
        "Назар",
        "Тарас",
        "Люба",
        "Анатолій",
        "Андрій",
        "Пан Іван",
        "Саша О"
    ];

    return {
        PLAYER_LIST,
        DEFAULT_SELECTED: new Set(PLAYER_LIST.slice(0, 5)),
        DEFAULT_AVOID_RECENT_ROUNDS: 2,
        DEFAULT_COURT_RENTAL_COST: 600,
        PLAYER_PICK_ATTEMPTS: 400,
        COURT_PIN_PRIORITY_BASE: 3,
        GAME_DURATION_MINUTES: 10,
        TIME_RANGE_SEPARATOR: "–"
    };
});
