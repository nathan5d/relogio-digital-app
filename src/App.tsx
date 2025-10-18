import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
} from "react";

// Definições de Tipos (Interfaces)
// ----------------------------------------------------

type Mode = "TIME" | "DATE" | "TEMP" | "STOPWATCH" | "TIMER";

interface AlarmState {
  enabled: boolean;
  time: string; // "HH:MM"
}

interface DisplayContent {
  main: React.ReactNode;
  sub: React.ReactNode;
  label: string;
}

interface StopwatchRef {
  startAt: number | null;
  accumulated: number; // ms
}

interface TimerRef {
  endAt: number | null;
  base: number; // ms (duração original)
}

// Helpers para Geolocation
interface Position {
    coords: GeolocationCoordinates;
    timestamp: number;
}
interface GeolocationPositionError {
    readonly code: number;
    readonly message: string;
}

// Funções Auxiliares
// ----------------------------------------------------

// Define um tipo genérico T para garantir que o valor retornado seja do tipo esperado
const loadFromStorage = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error("Erro ao carregar do localStorage:", e);
    return fallback;
  }
};
const saveToStorage = (key: string, value: any): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("Erro ao salvar no localStorage:", e);
  }
};

const MODES: Mode[] = ["TIME", "DATE", "TEMP", "STOPWATCH", "TIMER"]; // cycle order

// Componente Principal
// ----------------------------------------------------

const App: React.FC = () => {
  /* ---------- Core time state ---------- */
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    // Atualiza a hora a cada segundo
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  /* ---------- UI / Mode ---------- */
  const [modeIndex, setModeIndex] = useState<number>(0);
  const mode: Mode = MODES[modeIndex];
  const cycleMode = useCallback((): void => {
    setModeIndex((m) => (m + 1) % MODES.length);
  }, []);

  /* Show/hide controls (auto-hide) */
  const [showControls, setShowControls] = useState<boolean>(false);
  const hideControlsTimerRef = useRef<number | null>(null);
  const touchOrMove = useCallback((): void => {
    setShowControls(true);
    if (hideControlsTimerRef.current)
      clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = setTimeout(
      () => setShowControls(false),
      3500
    );
  }, []);

  useEffect(() => {
    // show on mount briefly
    touchOrMove();
    return () => {
      if (hideControlsTimerRef.current)
        clearTimeout(hideControlsTimerRef.current);
    };
  }, [touchOrMove]);

  /* ---------- Display format 12/24 ---------- */
  const [is24h, setIs24h] = useState<boolean>(loadFromStorage("clock_is24h", true));
  useEffect(() => saveToStorage("clock_is24h", is24h), [is24h]);

  /* ---------- Temperature (real-time via geolocation + auto refresh) ---------- */
  // 'null' para indicar estado de carregamento inicial
  const [rawTemperatureC, setRawTemperatureC] = useState<number | null>(null);
  const [isCelsius, setIsCelsius] = useState<boolean>(
    loadFromStorage("clock_isCelsius", true)
  );
  const [locationStatus, setLocationStatus] = useState<string>("BUSCANDO...");
  const [locationName, setLocationName] = useState<string>("CIDADE");

  useEffect(() => saveToStorage("clock_isCelsius", isCelsius), [isCelsius]);

  const fetchTemperature = useCallback((): void => {
    if (!navigator.geolocation) {
      setLocationStatus("SEM GPS");
      setRawTemperatureC(25); // Fallback
      setLocationName("Localização Não Suportada");
      return;
    }

    setLocationStatus("BUSCANDO...");
    setRawTemperatureC(null);

    navigator.geolocation.getCurrentPosition(
      async (pos: Position) => { // Type 'pos'
        const { latitude, longitude } = pos.coords;
        setLocationStatus("OK");

        // --- API 1: Reverse Geocoding (Nominatim - OpenStreetMap) ---
        let city: string = "Localização Atual";
        try {
          const geoRes = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`
          );
          const geoData = await geoRes.json();

          // Tenta extrair o nome da cidade/país de forma robusta
          const address = geoData.address || {};
          city =
            address.city ||
            address.town ||
            address.village ||
            address.state ||
            address.country ||
            (geoData.display_name?.split(",")?.slice(0, 2)?.join(", ")?.trim()) ||
            "Localização Atual";

          setLocationName(city);
        } catch (error) {
          console.error("Erro ao buscar nome da localização:", error);
          setLocationName("Localização Atual");
        }

        // --- API 2: Weather (OpenMeteo) ---
        try {
          const weatherRes = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&temperature_unit=celsius`
          );
          const weatherData = await weatherRes.json();

          const tempC = weatherData?.current_weather?.temperature;
          if (typeof tempC === "number") {
            setRawTemperatureC(tempC); // Armazena o valor RAW em Celsius
          } else {
            setRawTemperatureC(25); // Fallback
          }
        } catch (error) {
          console.error("Erro ao buscar temperatura:", error);
          setRawTemperatureC(25); // Fallback
        }
      },
      (err: GeolocationPositionError) => { // Type 'err'
        console.warn("Erro ao obter localização:", err);
        setLocationStatus("BLOQUEADO");
        setRawTemperatureC(25);
        setLocationName("GPS Bloqueado");
      }
    );
  }, []); // isCelsius removido das dependências para evitar re-fetch na troca de unidade

  useEffect(() => {
    fetchTemperature();
    const interval = setInterval(fetchTemperature, 10 * 60 * 1000); // Atualiza a cada 10 minutos
    return () => clearInterval(interval);
  }, [fetchTemperature]);

  /* ---------- Alarm ---------- */
  const [alarm, setAlarm] = useState<AlarmState>(() => // Type AlarmState
    loadFromStorage("clock_alarm", { enabled: false, time: "07:30" })
  );
  useEffect(() => saveToStorage("clock_alarm", alarm), [alarm]);

  const [isAlarmRinging, setIsAlarmRinging] = useState<boolean>(false);
  const alarmTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!alarm.enabled) {
      setIsAlarmRinging(false);
      if (alarmTimeoutRef.current) {
        clearTimeout(alarmTimeoutRef.current);
        alarmTimeoutRef.current = null;
      }
    }
  }, [alarm.enabled]);

  // Check alarm every minute (we already update 'now' every second)
  useEffect(() => {
    if (alarm.enabled && !isAlarmRinging) {
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const cur = `${hh}:${mm}`;
      if (cur === alarm.time) {
        setIsAlarmRinging(true);
        // auto stop ringing after 60s
        alarmTimeoutRef.current = setTimeout(
          () => setIsAlarmRinging(false),
          60000
        );
      }
    }
    return () => {};
  }, [now, alarm, isAlarmRinging]);

  const stopAlarm = (): void => {
    setIsAlarmRinging(false);
    if (alarmTimeoutRef.current) {
      clearTimeout(alarmTimeoutRef.current);
      alarmTimeoutRef.current = null;
    }
  };

  /* ---------- Stopwatch ---------- */
  const [swRunning, setSwRunning] = useState<boolean>(false);
  const [swElapsed, setSwElapsed] = useState<number>(() => // Type number (ms)
    loadFromStorage("clock_stopwatch", 0)
  ); // ms
  const swRef = useRef<StopwatchRef>({ startAt: null, accumulated: swElapsed }); // Type StopwatchRef
  // persist stopwatch on change
  useEffect(() => saveToStorage("clock_stopwatch", swElapsed), [swElapsed]);

  useEffect(() => {
    let id: number | null = null;
    if (swRunning) {
      // Use Date.now() for better clock sync, though performance.now() is often preferred for precision,
      // Date.now() avoids issues with system sleep and keeps it simpler for this context.
      swRef.current.startAt = Date.now() - swRef.current.accumulated; // Calculate start time based on accumulated time
      id = setInterval(() => {
        const nowp = Date.now();
        const total = nowp - (swRef.current.startAt || nowp); // Safety check for startAt
        setSwElapsed(Math.floor(total));
      }, 100);
    } else {
      // paused; freeze and accumulate
      if (swRef.current.startAt) {
        swRef.current.accumulated = swElapsed; // Use current elapsed time as accumulated
        swRef.current.startAt = null;
      }
    }
    return () => {
      if (id) clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swRunning]);

  const swStartPause = (): void => {
    setSwRunning((r) => {
      // Before setting running state, update accumulated time if pausing
      if (r && swRef.current.startAt) {
        swRef.current.accumulated = swElapsed;
      }
      return !r;
    });
  };
  const swReset = (): void => {
    setSwRunning(false);
    swRef.current = { startAt: null, accumulated: 0 };
    setSwElapsed(0);
  };

  /* ---------- Timer (countdown) ---------- */
  const [timerRunning, setTimerRunning] = useState<boolean>(false);
  const [timerRemaining, setTimerRemaining] = useState<number>(() => // Type number (ms)
    loadFromStorage("clock_timer_ms", 0)
  ); // ms
  const timerRef = useRef<TimerRef>({ endAt: null, base: timerRemaining }); // Type TimerRef

  useEffect(
    () => saveToStorage("clock_timer_ms", timerRemaining),
    [timerRemaining]
  );

  useEffect(() => {
    let id: number | null = null;
    if (timerRunning && timerRef.current.endAt) {
      id = setInterval(() => {
        const nowp = Date.now();
        const left = Math.max(0, timerRef.current.endAt! - nowp); // Use non-null assertion as it's checked above
        setTimerRemaining(left);
        if (left === 0) {
          setTimerRunning(false);
          // small "ring" effect via setting alarm-like state
          setIsAlarmRinging(true);
          setTimeout(() => setIsAlarmRinging(false), 5000);
        }
      }, 250);
    }
    return () => {
      if (id) clearInterval(id);
    };
  }, [timerRunning]);

  const timerStart = (ms: number): void => { // Type ms
    // If starting a paused timer, use current remaining time
    const startMs: number = timerRunning ? timerRemaining : ms;
    if (startMs <= 0) return;

    // If starting from a clean slate or new setting, update base
    if (!timerRunning) {
      timerRef.current.base = startMs;
    }

    timerRef.current.endAt = Date.now() + startMs;
    setTimerRemaining(startMs);
    setTimerRunning(true);
  };

  const timerPause = (): void => {
    if (!timerRunning) return; // Already paused

    setTimerRunning(false);

    if (timerRef.current.endAt) {
      const left = Math.max(0, timerRef.current.endAt - Date.now());
      setTimerRemaining(left);
      timerRef.current.base = left; // Update base to remaining time for restart
      timerRef.current.endAt = null;
    }
  };

  const timerReset = (): void => {
    setTimerRunning(false);
    timerRef.current = { endAt: null, base: 0 };
    setTimerRemaining(0);
    setIsAlarmRinging(false); // Stop ringing if reset happens
    if (alarmTimeoutRef.current) {
      clearTimeout(alarmTimeoutRef.current);
      alarmTimeoutRef.current = null;
    }
  };

  /* ---------- Small UI state for modals/forms ---------- */
  const [showAlarmEditor, setShowAlarmEditor] = useState<boolean>(false);
  const [showTimerEditor, setShowTimerEditor] = useState<boolean>(false);

  // local controlled input values
  const [alarmInput, setAlarmInput] = useState<string>(alarm.time);
  useEffect(() => setAlarmInput(alarm.time), [alarm.time]);

  const saveAlarm = (enabled: boolean, timeStr: string): void => { // Type parameters
    setAlarm({ enabled, time: timeStr });
    setShowAlarmEditor(false);
  };

  const [timerMinutesInput, setTimerMinutesInput] = useState<string>("00");
  const [timerSecondsInput, setTimerSecondsInput] = useState<string>("00");

  const saveTimerFromForm = (minutes: string, seconds: string): void => { // Type parameters
    const total = Math.max(0, Number(minutes) * 60 + Number(seconds)) * 1000;
    timerReset(); // Always reset first to clear previous state
    timerStart(total);
    setShowTimerEditor(false);
  };

  /* ---------- Display content ---------- */
  const display: DisplayContent = useMemo(() => { // Type DisplayContent
    // Time formatting
    const hoursRaw: number = now.getHours();
    const displayHours: number = is24h ? hoursRaw : hoursRaw % 12 || 12;
    const minutes: string = String(now.getMinutes()).padStart(2, "0");
    const ampm: string = is24h ? "" : hoursRaw >= 12 ? "PM" : "AM";

    switch (mode) {
      case "TIME":
        return {
          main: (
            <>
              {String(displayHours).padStart(2, "0")}
              <span className="blink">:</span>
              {minutes}
            </>
          ),
          sub: is24h ? "" : ampm,
          label: "HORA",
        };
      case "DATE": {
        const dd: string = String(now.getDate()).padStart(2, "0");
        const mm: string = String(now.getMonth() + 1).padStart(2, "0");
        const yy: string = String(now.getFullYear()).slice(-2);
        return {
          main: `${dd}.${mm}.${yy}`,
          sub: `${now
            .toLocaleString(undefined, { weekday: "short" })
            .toUpperCase()}`,
          label: "DATA",
        };
      }
      case "TEMP": {
        let displayTemp: string;
        if (rawTemperatureC === null) {
          displayTemp = "...°C"; // Carregando
        } else if (isCelsius) {
          displayTemp = `${
            rawTemperatureC !== null ? rawTemperatureC.toFixed(1) : "..."
          }°C`;
        } else {
          // Conversão instantânea: Celsius para Fahrenheit
          displayTemp = `${
            rawTemperatureC !== null
              ? (rawTemperatureC * 1.8 + 32).toFixed(1)
              : "..."
          }°F`;
        }

        return {
          main: displayTemp,
          // Exibe o nome da localização ou o status de busca
          sub: locationStatus === "OK" ? locationName : locationStatus,
          label: "TEMP",
        };
      }

      case "STOPWATCH": {
        const totalMs: number = swElapsed;
        const cs: number = Math.floor((totalMs % 1000) / 10); // centiseconds
        const s: number = Math.floor(totalMs / 1000) % 60;
        const m: number = Math.floor(totalMs / 60000);
        return {
          main: `${String(m).padStart(2, "0")}:${String(s).padStart(
            2,
            "0"
          )}.${String(cs).padStart(2, "0")}`,
          sub: swRunning ? "RUN" : "PAUSE",
          label: "CRONÔMETRO",
        };
      }
      case "TIMER": {
        const left: number = timerRemaining;
        const sTotal: number = Math.ceil(left / 1000);
        const s: number = sTotal % 60;
        const m: number = Math.floor(sTotal / 60);

        // Se o timer não estiver rodando e remaining for 0, mostra a duração base se houver.
        const effectiveM: number =
          timerRunning || timerRemaining > 0
            ? m
            : Math.floor(timerRef.current.base / 60000);
        const effectiveS: number =
          timerRunning || timerRemaining > 0
            ? s
            : Math.floor((timerRef.current.base % 60000) / 1000);

        return {
          main: `${String(effectiveM).padStart(2, "0")}:${String(
            effectiveS
          ).padStart(2, "0")}`,
          sub: timerRunning
            ? "TIMER RUN"
            : timerRemaining > 0
            ? "PAUSE"
            : "SET",
          label: "CONTADOR",
        };
      }
      default:
        return { main: "--:--", sub: "", label: "" };
    }
  }, [
    mode,
    now,
    is24h,
    rawTemperatureC,
    isCelsius,
    locationStatus,
    locationName,
    swElapsed,
    swRunning,
    timerRemaining,
    timerRunning,
    timerRef,
  ]);

  /* ---------- Small accessibility/keyboard handlers ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { // Type KeyboardEvent
      if (e.key === " ") {
        // space toggles mode (for convenience)
        e.preventDefault();
        cycleMode();
      }
      if (e.key === "a") {
        setShowAlarmEditor(true);
        touchOrMove();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycleMode, touchOrMove]);

  /* ---------- Touch handler: tap to cycle mode ---------- */
  const lastTapRef = useRef<number>(0);
  const handleTap = (e: React.MouseEvent<HTMLDivElement>): void => { // Type React.MouseEvent
    e.preventDefault();
    const nowt = Date.now();
    lastTapRef.current = nowt;
    // single tap: cycle mode
    cycleMode();
    touchOrMove();
    // long press? not implemented here; we use controls icon instead
  };

  /* ---------- Styles (JSX inlined) ---------- */
  const containerStyle: React.CSSProperties = { // Type React.CSSProperties
    WebkitUserSelect: "none",
    userSelect: "none",
    width: "100vw",
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#000", // pure black for minimal look
    color: "#fff",
    touchAction: "manipulation",
  };

  /* ---------- Render ---------- */
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&display=swap');

        body { margin: 0; padding: 0; }

        .clock-frame {
          width: 96%;
          max-width: 1200px;
          aspect-ratio: 4/1.2;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          border-radius: 10px;
          background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
          padding: 2rem;
          box-sizing: border-box;
          user-select: none;
        }

        .display {
          font-family: 'Orbitron', system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
          font-weight: 700;
          letter-spacing: 0.02em;
          text-transform: none;
          text-align: center;
          color: #e6fff6;
          line-height: 0.95;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        /* LED-like (subtle) */
        .digit-led {
          text-shadow:
            0 0 6px rgba(230,255,246,0.25),
            0 0 14px rgba(230,255,246,0.08);
        }

       .label {
          position: absolute;
          top: 6px;          /* sobe um pouco */
          left: 18px;
          font-size: 0.8rem;
          color: #9ca3af;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .sub {
          position: absolute;
          top: 6px;
          right: 18px;
          font-size: 0.9rem;
          color: #a7f3d0;
          opacity: 0.9;
          letter-spacing: 0.05em;
        }
        
        /* Location Name adjustment */
        .sub.location-name {
            font-size: 0.75rem; /* slightly smaller */
            max-width: 50%;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            top: 28px; /* positioned below the unit toggle */
            right: 18px;
            color: #9ca3af;
        }


        /* AL: status separado, canto esquerdo inferior */
        .alarm-indicator {
          position: absolute;
          bottom: 28px;
          left: 18px;
          font-size: 0.8rem;
          color: #6b7280;
          letter-spacing: 0.1em;
        }

        /* piscar dos dois pontos */
        .blink {
          animation: blink 1s steps(1, start) infinite;
        }
        @keyframes blink {
          50% {
            opacity: 0;
          }
        }

        /* controls (appear on hover/touch) */
        .controls {
          position: absolute;
          bottom: 14px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 10px;
          opacity: 0;
          transition: opacity 200ms;
        }
        .controls.visible { opacity: 1; }
        .ctrl-btn {
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.06);
          padding: 8px 12px;
          color: #e6fff6;
          border-radius: 8px;
          font-weight: 700;
          cursor: pointer;
          min-width: 44px;
          transition: all 0.1s ease;
        }
        .ctrl-btn:hover { background: rgba(255,255,255,0.1); }
        .ctrl-btn:active { transform: translateY(1px); }

        .corner-btn {
          position: absolute;
          top: 20px;
          right: 12px;
          background: none;
          border-radius: 8px;
          padding: 6px;
          display: flex;
          gap: 6px;
        }

        .small {
          font-size: 0.9rem;
          opacity: 0.9;
        }

        /* responsive sizes */
        @media (min-width: 1200px) {
          .display { font-size: 12rem; }
        }
        @media (min-width: 800px) and (max-width:1199px) {
          .display { font-size: 9rem; }
        }
        @media (max-width: 799px) {
          .clock-frame { padding: 1.25rem; }
          .display { font-size: 14vmin; } /* responsive for mobile */
        }

        /* modal overlay */
        .overlay {
          position: fixed; inset: 0;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0,0,0,0.8); z-index: 30;
        }
        .card {
          background: #0b1220;
          padding: 1.5rem;
          border-radius: 12px;
          min-width: 280px;
          color: #e6fff6;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        }
        .form-row { display:flex; gap:10px; margin-bottom: 12px; align-items:center; }
        .input {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.1);
          color: #e6fff6;
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 1rem;
          min-width: 0;
          flex-grow: 1;
        }
        .display {
          transition: all 0.3s ease-in-out;
        }
        
        /* Alarm Ringing Effect */
        .alarm-ring-overlay {
            animation: ring-pulse 1s infinite alternate;
        }
        @keyframes ring-pulse {
            from { box-shadow: 0 0 10px #ff6666, 0 0 20px #ff6666; }
            to { box-shadow: 0 0 20px #ff0000, 0 0 40px #ff0000; }
        }
      `}</style>

      <div
        style={containerStyle}
        onMouseMove={touchOrMove}
        onTouchStart={touchOrMove}
        onClick={handleTap}
      >
        <div
          className={`clock-frame ${
            isAlarmRinging ? "alarm-ring-overlay" : ""
          }`}
          role="application"
          aria-label="Relógio digital"
        >
          <div className="label">{display.label}</div>

          {/* Unidade de Temperatura/Hora 12/24 */}
          <div className="sub small">
            {mode !== "TEMP" ? (
              is24h ? (
                "24H"
              ) : (
                "12H"
              )
            ) : (
              <button
                className="ctrl-btn"
                onClick={(e: React.MouseEvent<HTMLButtonElement>) => { // Type e
                  e.stopPropagation();
                  setIsCelsius((prev) => !prev);
                }}
                title="Alternar entre °C e °F"
                style={{
                  padding: "4px 8px",
                  fontSize: "0.75rem",
                  lineHeight: 1,
                  height: "auto",
                  background: "rgba(255,255,255,0.1)",
                }}
              >
                {isCelsius ? "°C" : "°F"}
              </button>
            )}
          </div>

          {/* Nome da Localização para o modo TEMP */}
          {mode === "TEMP" && (
            <div className="sub small location-name">
              {locationStatus === "OK" ? locationName : locationStatus}
            </div>
          )}

          {/* Main display */}
          <div
            className="display digit-led"
            style={{
              width: "100%",
              textAlign: "right",
              fontSize:
                mode === "DATE" || mode === "TEMP" ? "7vmina" : undefined, // Adjust font size for non-time modes
            }}
          >
            {display.main}
          </div>

          {/* Corner small actions: toggle 12/24, alarm editor, timer editor */}
          <div className="alarm-indicator">
            AL: {alarm.enabled ? alarm.time : "OFF"}
          </div>

          <div
            className="corner-btn"
            style={{
              right: 12,
              top: 12,
              display: mode === "TEMP" ? "none" : "flex",
            }}
          >
            {mode === "TIME" && (
              <button
                className="ctrl-btn"
                onClick={(e: React.MouseEvent<HTMLButtonElement>) => { // Type e
                  e.stopPropagation();
                  setIs24h((v) => !v);
                  touchOrMove();
                }}
                title="Alternar 12/24h"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  padding: "6px 10px",
                }}
              >
                {is24h ? "24H" : "12H"}
              </button>
            )}
            <button
              className="ctrl-btn"
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => { // Type e
                e.stopPropagation();
                setShowAlarmEditor(true);
                touchOrMove();
              }}
              title="Configurar alarme"
              style={{
                background: "rgba(255,255,255,0.04)",
                padding: "6px 10px",
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.375 22h3.25" />
                <path d="M12 2c-.757 0-1.78.332-2.5.83-1.076.745-1.5 1.76-1.5 2.17.65.65 1.5.97 2.5.97h3c1 0 1.85-.32 2.5-.97 0-.41-.424-1.425-1.5-2.17C13.78 2.332 12.757 2 12 2Z" />
              </svg>
            </button>
            <button
              className="ctrl-btn"
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => { // Type e
                e.stopPropagation();
                setShowTimerEditor(true);
                touchOrMove();
              }}
              title="Configurar contador"
              style={{
                background: "rgba(255,255,255,0.04)",
                padding: "6px 10px",
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 2h4" />
                <path d="M21 16V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7" />
                <path d="M17 21v-4a2 2 0 0 1 2-2h4" />
                <path d="M7 10h.01" />
                <path d="M11 10h.01" />
                <path d="M15 10h.01" />
              </svg>
            </button>
          </div>

          {/* Controls (center bottom) */}
          <div className={`controls ${showControls ? "visible" : ""}`}>
            {/* Contextual controls */}
            {mode === "STOPWATCH" ? (
              <>
                <button
                  className="ctrl-btn"
                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => { // Type e
                    e.stopPropagation();
                    swStartPause();
                    touchOrMove();
                  }}
                  style={{ background: swRunning ? "#b91c1c" : "#16a34a" }}
                >
                  {swRunning ? "PAUSE" : "START"}
                </button>
                <button
                  className="ctrl-btn"
                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => { // Type e
                    e.stopPropagation();
                    swReset();
                    touchOrMove();
                  }}
                >
                  RESET
                </button>
              </>
            ) : mode === "TIMER" ? (
              <>
                {(!timerRunning && timerRemaining > 0) ||
                (timerRemaining === 0 && timerRef.current.base > 0) ? (
                  <button
                    className="ctrl-btn"
                    onClick={(e: React.MouseEvent<HTMLButtonElement>) => { // Type e
                      e.stopPropagation();
                      timerStart(
                        timerRemaining > 0
                          ? timerRemaining
                          : timerRef.current.base
                      );
                      touchOrMove();
                    }}
                    style={{ background: "#16a34a" }}
                  >
                    START
                  </button>
                ) : (
                  <button
                    className="ctrl-btn"
                    onClick={(e: React.MouseEvent<HTMLButtonElement>) => { // Type e
                      e.stopPropagation();
                      timerPause();
                      touchOrMove();
                    }}
                    style={{
                      background: timerRunning
                        ? "#b91c1c"
                        : "rgba(255,255,255,0.06)",
                    }}
                    disabled={!timerRunning}
                  >
                    PAUSE
                  </button>
                )}
                <button
                  className="ctrl-btn"
                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => { // Type e
                    e.stopPropagation();
                    timerReset();
                    touchOrMove();
                  }}
                >
                  RESET
                </button>
              </>
            ) : (
              // default generic controls: change mode, toggle alarm enabled
              <>
                <button
                  className="ctrl-btn"
                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => { // Type e
                    e.stopPropagation();
                    cycleMode();
                    touchOrMove();
                  }}
                >
                  NEXT MODE
                </button>
                <button
                  className="ctrl-btn"
                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => { // Type e
                    e.stopPropagation();
                    setAlarm((a) => ({ ...a, enabled: !a.enabled }));
                    touchOrMove();
                  }}
                  style={{ background: alarm.enabled ? "#b91c1c" : "#047857" }}
                >
                  {alarm.enabled ? "AL OFF" : "AL ON"}
                </button>
              </>
            )}
          </div>

          {/* Small overlay to show alarm ringing */}
          {isAlarmRinging && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 20,
                background: "rgba(0,0,0,0.8)",
                pointerEvents: "auto",
                borderRadius: 10,
              }}
              onClick={(e: React.MouseEvent<HTMLDivElement>) => { // Type e
                e.stopPropagation();
                stopAlarm();
              }}
            >
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    fontSize: 48,
                    fontWeight: 700,
                    color: "#ffb4b4",
                    animation: "blink 0.5s steps(1, start) infinite",
                  }}
                  className="digit-led"
                >
                  ALARME!
                </div>
                <div
                  style={{
                    marginTop: 8,
                    color: "#ffdede",
                    fontSize: 24,
                    fontFamily: "Orbitron",
                  }}
                >
                  {alarm.time}
                </div>
                <div style={{ marginTop: 14 }}>
                  <button
                    className="ctrl-btn"
                    onClick={(ev: React.MouseEvent<HTMLButtonElement>) => { // Type ev
                      ev.stopPropagation();
                      stopAlarm();
                    }}
                    style={{ background: "#b91c1c" }}
                  >
                    PARAR
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------- Alarm Editor Modal ---------- */}
      {showAlarmEditor && (
        <div className="overlay" onClick={() => setShowAlarmEditor(false)}>
          <div className="card" onClick={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()}>
            <h3 style={{ margin: 0, marginBottom: 16 }}>Configurar Alarme</h3>

            <div className="form-row">
                <label style={{ minWidth: 50 }}>Hora:</label>
                <input
                    type="time"
                    className="input"
                    value={alarmInput}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAlarmInput(e.target.value)}
                    style={{ fontFamily: 'Orbitron' }}
                />
            </div>
            <div className="form-row" style={{ alignItems: 'flex-start' }}>
                <label style={{ minWidth: 50, paddingTop: 10 }}>Status:</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexGrow: 1, padding: 8 }}>
                    <input
                        type="checkbox"
                        checked={alarm.enabled}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAlarm((a) => ({ ...a, enabled: e.target.checked }))}
                    />
                    {alarm.enabled ? 'Ativo' : 'Desativado'}
                </label>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                <button
                    className="ctrl-btn"
                    onClick={() => setShowAlarmEditor(false)}
                    style={{ background: 'none', borderColor: '#4a5568', color: '#a0aec0' }}
                >
                    Cancelar
                </button>
                <button
                    className="ctrl-btn"
                    onClick={() => saveAlarm(alarm.enabled, alarmInput)}
                    style={{ background: '#047857' }}
                    disabled={!alarmInput}
                >
                    Salvar
                </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Timer Editor Modal ---------- */}
      {showTimerEditor && (
        <div className="overlay" onClick={() => setShowTimerEditor(false)}>
            <div className="card" onClick={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()}>
                <h3 style={{ margin: 0, marginBottom: 16 }}>Configurar Contador</h3>

                <p style={{ color: '#a0aec0', fontSize: '0.85rem', marginBottom: 12 }}>Defina a duração da contagem regressiva.</p>

                <div className="form-row">
                    <label style={{ minWidth: 50 }}>Minutos:</label>
                    <input
                        type="number"
                        className="input"
                        value={timerMinutesInput}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTimerMinutesInput(e.target.value.padStart(2, '0').slice(-2))}
                        min="0"
                        max="99"
                        style={{ fontFamily: 'Orbitron', textAlign: 'center' }}
                    />
                </div>
                <div className="form-row">
                    <label style={{ minWidth: 50 }}>Segundos:</label>
                    <input
                        type="number"
                        className="input"
                        value={timerSecondsInput}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTimerSecondsInput(e.target.value.padStart(2, '0').slice(-2))}
                        min="0"
                        max="59"
                        style={{ fontFamily: 'Orbitron', textAlign: 'center' }}
                    />
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                    <button
                        className="ctrl-btn"
                        onClick={() => setShowTimerEditor(false)}
                        style={{ background: 'none', borderColor: '#4a5568', color: '#a0aec0' }}
                    >
                        Cancelar
                    </button>
                    <button
                        className="ctrl-btn"
                        onClick={() => saveTimerFromForm(timerMinutesInput, timerSecondsInput)}
                        style={{ background: '#047857' }}
                        disabled={!timerMinutesInput && !timerSecondsInput}
                    >
                        Salvar & Iniciar
                    </button>
                </div>
            </div>
        </div>
      )}
    </>
  );
};

export default App;
