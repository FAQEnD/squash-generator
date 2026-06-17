(function (root, factory) {
    const config =
        typeof module !== "undefined" && module.exports
            ? require("./config.js")
            : root.SquashConfig;
    const api = factory(config);

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }

    root.SquashTime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (config) {
    function parseTimeToMinutes(time) {
        const [hours, minutes] = time.split(":").map(Number);
        return hours * 60 + minutes;
    }

    function formatTime(totalMinutes) {
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }

    function formatTimeRange(startMinutes, durationMinutes) {
        const endMinutes = startMinutes + durationMinutes;
        return `${formatTime(startMinutes)}${config.TIME_RANGE_SEPARATOR}${formatTime(endMinutes)}`;
    }

    function parseTimeRange(timeRange) {
        const escapedSeparator = config.TIME_RANGE_SEPARATOR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = timeRange.match(
            new RegExp(`(\\d{2}):(\\d{2})[${escapedSeparator}-](\\d{2}):(\\d{2})`)
        );

        if (!match) return null;

        return {
            start: parseInt(match[1], 10) * 60 + parseInt(match[2], 10),
            end: parseInt(match[3], 10) * 60 + parseInt(match[4], 10)
        };
    }

    function isMinuteInRange(minute, range) {
        return minute >= range.start && minute < range.end;
    }

    return {
        parseTimeToMinutes,
        formatTime,
        formatTimeRange,
        parseTimeRange,
        isMinuteInRange
    };
});
