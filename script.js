const generator = window.SquashGenerator;
const shareState = window.SquashShareState;
const ui = window.SquashUi;

function generate() {
    const options = ui.readScheduleOptions();

    let schedule;
    try {
        schedule = generator.generateSchedule(options);
    } catch (e) {
        alert(e.message);
        return;
    }

    ui.renderTable(schedule.results, options.courts);
    ui.renderStats(
        schedule.playerCount,
        schedule.pairCount,
        schedule.courtPins,
        schedule.courtPinOrder
    );

    document.getElementById("afterGenRow").classList.remove("hidden");
    ui.startGameTimeHighlighter();
}

function shareLink() {
    const url = shareState.createShareUrl(location, ui.readShareState());
    navigator.clipboard.writeText(url);

    alert("Посилання скопійовано!");
}

function loadFromHash() {
    if (!location.hash) return false;

    let state;
    try {
        state = shareState.decodeState(location.hash);
    } catch {
        return false;
    }

    ui.applyShareState(state);
    return true;
}

function bindEvents() {
    document.getElementById("games").addEventListener("input", ui.syncAvailabilityPlaceholders);
    document.getElementById("refreshSeed").addEventListener("click", ui.autoSeed);
    document.getElementById("generateBtn").addEventListener("click", generate);
    document.getElementById("exportCsvBtn").addEventListener("click", ui.exportCSV);
    document.getElementById("exportPdfBtn").addEventListener("click", () => window.print());
    document.getElementById("shareBtn").addEventListener("click", shareLink);
}

ui.initPlayers();
bindEvents();
ui.autoSeed();

if (loadFromHash()) {
    generate();
    ui.applyReadonlyMode(true);
}
