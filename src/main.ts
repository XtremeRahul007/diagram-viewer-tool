import "./style.css";
import type { Mermaid } from "mermaid";

interface DiagramEntry {
  title: string;
  type: string;
  definition: string;
}

type DiagramMap = Record<string, DiagramEntry>;

const DIAGRAMS_URL = `${import.meta.env.BASE_URL}/diagrams.json`;
const DEFAULT_DIAGRAM_ID = "auth-flow";

let mermaid: Mermaid | null = null;
let svgPanZoom: any = null;
let Hammer: any = null;
let panZoomInstance: any = null;
let diagrams: DiagramMap = {};
let librariesLoading: Promise<void> | null = null;
let librariesReady = false;

const mobileEventsHandler = {
  haltEventListeners: [
    "touchstart",
    "touchend",
    "touchmove",
    "touchleave",
    "touchcancel",
  ],
  init: function (options: any) {
    const instance = options.instance;
    let initialScale = 1;
    let pannedX = 0;
    let pannedY = 0;

    this.hammer = new Hammer(options.svgElement, {
      recognizers: [
        [Hammer.Pan, { direction: Hammer.DIRECTION_ALL }],
        [Hammer.Pinch, { enable: true }],
      ],
    });

    this.hammer.on("panstart panmove", (ev: any) => {
      if (ev.type === "panstart") {
        pannedX = 0;
        pannedY = 0;
      }
      instance.panBy({ x: ev.deltaX - pannedX, y: ev.deltaY - pannedY });
      pannedX = ev.deltaX;
      pannedY = ev.deltaY;
    });

    this.hammer.on("pinchstart pinchmove", (ev: any) => {
      if (ev.type === "pinchstart") {
        initialScale = instance.getZoom();
      }
      instance.zoomAtPoint(initialScale * ev.scale, {
        x: ev.center.x,
        y: ev.center.y,
      });
    });

    options.svgElement.addEventListener(
      "touchmove",
      (e: TouchEvent) => e.preventDefault(),
      { passive: false },
    );
  },
  destroy: function () {
    this.hammer?.destroy();
  },
} as any;

function getRequiredElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Expected element #${id} to exist`);
  return el as T;
}

function setLoading(
  message: string,
  options: { show?: boolean; error?: boolean; onRetry?: () => void } = {},
) {
  const { show = true, error = false, onRetry } = options;
  const loading = getRequiredElement<HTMLDivElement>("loading");

  if (!show) {
    loading.style.display = "none";
    loading.innerHTML = "";
    return;
  }

  loading.style.display = "flex";
  loading.innerHTML = "";

  if (!error) {
    const spinner = document.createElement("div");
    spinner.className = "loading-spinner";
    loading.appendChild(spinner);
  }

  const text = document.createElement("div");
  text.className = "loading-message";
  text.textContent = message;
  loading.appendChild(text);

  if (error && onRetry) {
    const retryBtn = document.createElement("button");
    retryBtn.className = "retry-btn";
    retryBtn.textContent = "Retry";
    retryBtn.addEventListener("click", onRetry);
    loading.appendChild(retryBtn);
  }
}

function setZoomControlsEnabled(enabled: boolean) {
  ["zoom-in", "zoom-out", "reset"].forEach((id) => {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (btn) btn.disabled = !enabled;
  });
}

function getDiagramIdFromUrl(): string {
  const hashId = window.location.hash.replace(/^#/, "").trim();
  if (hashId) return hashId;

  const params = new URLSearchParams(window.location.search);
  const queryId = params.get("d");
  if (queryId) return queryId;

  return DEFAULT_DIAGRAM_ID;
}

async function loadDiagrams(): Promise<DiagramMap> {
  const res = await fetch(DIAGRAMS_URL);
  if (!res.ok) {
    throw new Error(
      `Failed to load ${DIAGRAMS_URL}: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as DiagramMap;
}

async function ensureLibrariesLoaded(): Promise<void> {
  if (librariesReady) return;

  if (librariesLoading) {
    await librariesLoading;
    return;
  }

  librariesLoading = (async () => {
    setLoading("Loading diagram renderer…");
    setZoomControlsEnabled(false);

    const [mermaidMod, svgPanZoomMod, hammerMod] = await Promise.all([
      import("mermaid"),
      import("svg-pan-zoom"),
      import("hammerjs"),
    ]);

    mermaid = mermaidMod.default;
    svgPanZoom = svgPanZoomMod.default;
    Hammer = hammerMod.default;

    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "loose",
      sequence: {
        useMaxWidth: false,
        wrap: true,
      },
    });

    librariesReady = true;
    setZoomControlsEnabled(true);
  })();

  try {
    await librariesLoading;
  } catch (err) {
    librariesLoading = null;
    throw err;
  }
}

function destroyExistingPanZoom(): void {
  panZoomInstance?.destroy();
  panZoomInstance = null;
}

async function renderDiagramById(id: string): Promise<void> {
  const container = getRequiredElement<HTMLDivElement>("diagram-container");
  const entry = diagrams[id];

  if (!entry) {
    setLoading(
      `No diagram found for "${id}". Available: ${Object.keys(diagrams).join(", ")}`,
      { error: true },
    );
    container.style.display = "none";
    return;
  }

  container.style.display = "none";
  destroyExistingPanZoom();

  try {
    await ensureLibrariesLoaded();
    setLoading("Rendering diagram…");

    const renderId = `mermaid-svg-${id}`;
    const { svg } = await mermaid!.render(renderId, entry.definition);

    container.innerHTML = svg;
    container.style.display = "block";
    setLoading("", { show: false });

    const svgEl = container.querySelector<SVGElement>("svg");
    if (!svgEl) {
      throw new Error("Mermaid did not render an <svg> element");
    }

    svgEl.removeAttribute("width");
    svgEl.removeAttribute("height");
    svgEl.style.maxWidth = "none";

    panZoomInstance = svgPanZoom(svgEl, {
      zoomEnabled: true,
      panEnabled: true,
      controlIconsEnabled: false,
      fit: true,
      center: true,
      minZoom: 0.3,
      maxZoom: 10,
      zoomScaleSensitivity: 0.4,
      customEventsHandler: mobileEventsHandler,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setLoading(`Failed to render diagram: ${message}`, {
      error: true,
      onRetry: () => void renderDiagramById(id),
    });
    container.style.display = "none";
  }
}

function populateDiagramPicker(): void {
  const picker = document.getElementById(
    "diagram-picker",
  ) as HTMLSelectElement | null;
  if (!picker) return;

  picker.innerHTML = "";
  for (const [id, entry] of Object.entries(diagrams)) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = entry.title;
    picker.appendChild(option);
  }

  picker.value = getDiagramIdFromUrl();

  picker.addEventListener("change", () => {
    window.location.hash = picker.value;
  });
}

async function init(): Promise<void> {
  setZoomControlsEnabled(false);
  setLoading("Loading diagram list…");

  try {
    diagrams = await loadDiagrams();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setLoading(`Failed to load diagrams: ${message}`, {
      error: true,
      onRetry: () => void init(),
    });
    return;
  }

  populateDiagramPicker();
  await renderDiagramById(getDiagramIdFromUrl());

  window.addEventListener("hashchange", () => {
    const id = getDiagramIdFromUrl();
    const picker = document.getElementById(
      "diagram-picker",
    ) as HTMLSelectElement | null;
    if (picker) picker.value = id;
    void renderDiagramById(id);
  });

  window.addEventListener("resize", () => {
    panZoomInstance?.resize();
    panZoomInstance?.fit();
    panZoomInstance?.center();
  });
}

// Zoom controls
getRequiredElement<HTMLButtonElement>("zoom-in").addEventListener("click", () =>
  panZoomInstance?.zoomIn(),
);
getRequiredElement<HTMLButtonElement>("zoom-out").addEventListener(
  "click",
  () => panZoomInstance?.zoomOut(),
);
getRequiredElement<HTMLButtonElement>("reset").addEventListener("click", () => {
  if (!panZoomInstance) return;
  panZoomInstance.resetZoom();
  panZoomInstance.fit();
  panZoomInstance.center();
});

void init();
