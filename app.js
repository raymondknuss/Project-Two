const OMDB_API_KEY = "bc3cfff7";
const BASE = "https://www.omdbapi.com/";

const root = document.documentElement;

const form = document.getElementById("searchForm");
const input = document.getElementById("search");
const clearBtn = document.getElementById("clearBtn");

const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");
const cardTemplate = document.getElementById("cardTemplate");

const themeBtn = document.getElementById("appearanceToggle");

const modal = document.getElementById("modal");
const overlay = document.getElementById("overlay");
const closeModalBtn = document.getElementById("closeModal");
const modalPoster = document.getElementById("modalPoster");
const modalTitle = document.getElementById("modalTitle");
const modalMeta = document.getElementById("modalMeta");
const modalPlot = document.getElementById("modalPlot");

const loadMoreBtn = document.createElement("button");
loadMoreBtn.className = "btn";
loadMoreBtn.type = "button";
loadMoreBtn.textContent = "Load more";
loadMoreBtn.style.margin = "8px auto 40px";
loadMoreBtn.style.display = "none";
resultsEl.insertAdjacentElement("afterend", loadMoreBtn);

let currentQuery = "";
let currentPage = 1;
let totalResults = 0;
let inFlight = null; // AbortController
const cache = new Map(); // `${q}:${page}` -> items

const debounce = (fn, delay = 400) => {
  let t, lastArgs, lastThis;
  const debounced = function (...args) {
    lastArgs = args;
    lastThis = this;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(lastThis, lastArgs), delay);
  };
  debounced.flush = () => {
    clearTimeout(t);
    if (lastArgs) fn.apply(lastThis, lastArgs);
  };
  return debounced;
};

function setStatus(msg = "") {
  statusEl.textContent = msg;
}
function setBusy(on) {
  resultsEl.setAttribute("aria-busy", on ? "true" : "false");
}
function posterSrc(poster) {
  return poster && poster !== "N/A"
    ? poster
    : "data:image/svg+xml;utf8," +
        encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" role="img" aria-label="No poster">
  <rect width="100%" height="100%" fill="#0f131a"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
    fill="#6b7280" font-family="Arial" font-size="22">No Poster</text>
</svg>`);
}
function updatePager() {
  const shown = resultsEl.querySelectorAll("[data-id]").length;
  const more = shown < totalResults;
  loadMoreBtn.style.display = more ? "inline-block" : "none";
  loadMoreBtn.disabled = !more;
}

const THEME_KEY = "theme_pref_v2";
function applyTheme(theme) {
  const dark = theme === "dark";
  root.setAttribute("data-theme", dark ? "dark" : "light");
  if (themeBtn) {
    themeBtn.textContent = dark ? "🌙 Dark" : "🔆 Light";
    themeBtn.setAttribute("aria-pressed", String(dark));
  }
}
function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function saveTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
}
let currentTheme = loadTheme();
applyTheme(currentTheme);
saveTheme(currentTheme);
themeBtn?.addEventListener("click", () => {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(currentTheme);
  saveTheme(currentTheme);
});

async function fetchJSON(url) {
  if (inFlight) inFlight.abort();
  inFlight = new AbortController();
  const res = await fetch(url, { signal: inFlight.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function fetchSearch(q, page = 1) {
  const key = `${q}:${page}`;
  if (cache.has(key)) return cache.get(key);

  const url = `${BASE}?apikey=${OMDB_API_KEY}&s=${encodeURIComponent(q)}&page=${page}`;
  const data = await fetchJSON(url);

  if (data.Response === "True" && Array.isArray(data.Search)) {
    cache.set(key, data.Search);
    totalResults = Number(data.totalResults || data.Search.length || 0);
    return data.Search;
  }
  totalResults = 0;
  return [];
}
async function fetchDetails(id) {
  const url = `${BASE}?apikey=${OMDB_API_KEY}&i=${encodeURIComponent(id)}&plot=short`;
  return fetchJSON(url);
}

function renderMovies(items = [], { append = false } = {}) {
  const frag = document.createDocumentFragment();

  for (const m of items) {
    const tpl = cardTemplate?.content?.cloneNode(true);
    if (tpl) {
      const art = tpl.querySelector("article");
      const img = tpl.querySelector(".poster");
      const title = tpl.querySelector(".title");
      const meta = tpl.querySelector(".meta");

      art.dataset.id = m.imdbID;
      img.alt = `${m.Title} poster`;
      img.loading = "lazy";
      img.src = posterSrc(m.Poster);
      title.textContent = m.Title || "Untitled";
      meta.textContent = `${m.Year ?? ""} · ${(m.Type || "").toUpperCase()}`;

      frag.append(tpl);
    } else {
      const article = document.createElement("article");
      article.className = "card";
      article.dataset.id = m.imdbID;

      const button = document.createElement("button");
      button.className = "card-button";
      button.type = "button";
      button.setAttribute("aria-haspopup", "dialog");

      const img = document.createElement("img");
      img.className = "poster";
      img.loading = "lazy";
      img.alt = `${m.Title} poster`;
      img.src = posterSrc(m.Poster);

      const body = document.createElement("div");
      body.className = "card-body";

      const h3 = document.createElement("h3");
      h3.className = "title";
      h3.textContent = m.Title || "Untitled";

      const meta = document.createElement("p");
      meta.className = "meta";
      meta.textContent = `${m.Year ?? ""} · ${(m.Type || "").toUpperCase()}`;

      body.append(h3, meta);
      button.append(img, body);
      article.append(button);
      frag.append(article);
    }
  }

  if (!append) resultsEl.innerHTML = "";
  resultsEl.appendChild(frag);
  updatePager();
}

async function runSearch(q, { page = 1, append = false } = {}) {
  if (!q || q.trim().length < 3) {
    resultsEl.innerHTML = "";
    totalResults = 0;
    updatePager();
    setStatus("Type at least 3 characters to search.");
    return;
  }

  setBusy(true);
  setStatus(page === 1 && !append ? "Searching…" : "Loading more…");

  try {
    const items = await fetchSearch(q.trim(), page);
    if (items.length) {
      renderMovies(items, { append });
      const shown = resultsEl.querySelectorAll("[data-id]").length;
      const total = totalResults && totalResults >= shown ? totalResults : shown;
      setStatus(`Showing ${shown} of ${total} result(s) for “${q}”.`);
    } else {
      if (page === 1) {
        resultsEl.innerHTML = "";
        setStatus("No results found.");
      } else {
        setStatus("No more results.");
      }
      updatePager();
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error(err);
      setStatus("Something went wrong fetching results. Please try again.");
    }
  } finally {
    setBusy(false);
  }
}

const debouncedSearch = debounce(() => {
  currentQuery = input.value;
  currentPage = 1;
  runSearch(currentQuery, { page: 1, append: false });
}, 400);

let lastFocused = null;

function openModal() {
  lastFocused = document.activeElement;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");

  const focusables = modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  (focusables[0] || closeModalBtn).focus();

  function trap(e) {
    if (e.key !== "Tab") return;
    const list = Array.from(
      modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter(el => !el.disabled && el.offsetParent !== null);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  modal.addEventListener("keydown", trap);
  modal._trapHandler = trap;
}

function hideModal() {
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  if (modal._trapHandler) {
    modal.removeEventListener("keydown", modal._trapHandler);
    delete modal._trapHandler;
  }
}

async function showDetails(id) {
  setStatus("Loading details…");
  try {
    const data = await fetchDetails(id);
    if (data && data.Response !== "False") {
      modalPoster.src = posterSrc(data.Poster);
      modalPoster.alt = `${data.Title} poster`;
      modalTitle.textContent = data.Title || "Untitled";
      modalMeta.textContent = [data.Year, data.Rated, data.Runtime, (data.Type || "").toUpperCase()]
        .filter(Boolean)
        .join(" · ");
      modalPlot.textContent = data.Plot && data.Plot !== "N/A" ? data.Plot : "No plot available.";
      openModal();
      setStatus("");
    } else {
      setStatus("Could not load details.");
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error(err);
      setStatus("Error loading details.");
    }
  }
}

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  debouncedSearch.flush();
});
input.addEventListener("input", () => debouncedSearch());
clearBtn.addEventListener("click", () => {
  input.value = "";
  input.focus();
  resultsEl.innerHTML = "";
  totalResults = 0;
  updatePager();
  setStatus("");
});
resultsEl.addEventListener("click", (e) => {
  const button = e.target.closest(".card-button, .card");
  if (!button) return;
  const article = button.closest("[data-id]");
  const id = article?.dataset.id;
  if (id) showDetails(id);
});
loadMoreBtn.addEventListener("click", () => {
  if (!currentQuery) return;
  currentPage += 1;
  runSearch(currentQuery, { page: currentPage, append: true });
});
overlay.addEventListener("click", hideModal);
closeModalBtn.addEventListener("click", hideModal);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal.getAttribute("aria-hidden") === "false") hideModal();
});

window.addEventListener("DOMContentLoaded", () => {
  input.value = "";
  currentQuery = "";
  currentPage = 1;
  runSearch(currentQuery, { page: 1, append: false });
});
