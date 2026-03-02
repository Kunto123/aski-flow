import { CSSProperties, useMemo } from "react";

const backdropStyle: CSSProperties = {
  background:
    "radial-gradient(circle at 18% 18%, rgba(229, 57, 53, 0.22), transparent 38%), radial-gradient(circle at 82% 74%, rgba(35, 95, 112, 0.36), transparent 42%), linear-gradient(165deg, #070d12 0%, #0d1d25 60%, #0a1117 100%)",
};

const spinnerStyle: CSSProperties = {
  width: "42px",
  height: "42px",
  borderRadius: "9999px",
  border: "3px solid rgba(255, 255, 255, 0.22)",
  borderTopColor: "#e53935",
  boxShadow: "0 0 16px rgba(229, 57, 53, 0.32)",
};

const LoadingScreen = () => {
  const logoSrc = useMemo(() => {
    return `${import.meta.env.BASE_URL}img/aski_logo.png`;
  }, []);

  return (
    <div
      className="fixed left-0 top-0 flex h-screen w-screen items-center justify-center"
      style={{ zIndex: 1000 }}
      id="loading-screen"
    >
      <div className="absolute inset-0" style={backdropStyle} />

      <div className="relative flex flex-col items-center justify-center space-y-4 px-6 text-center">
        <img
          src={logoSrc}
          alt="ASKI"
          className="h-auto w-[min(80vw,460px)] select-none"
          draggable={false}
        />
        <p className="text-xs font-semibold tracking-[0.14em] text-slate-200">
          INITIALIZING ASKI WORKSPACE
        </p>
        <div className="animate-spin" style={spinnerStyle} />
      </div>
    </div>
  );
};

export default LoadingScreen;
