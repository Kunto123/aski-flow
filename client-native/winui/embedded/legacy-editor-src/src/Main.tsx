import React, { useState } from "react";
import App from "./App";
import LoadingScreen from "./components/LoadingScreen";
import LoginPage from "./components/auth/LoginPage";
import { useAuth } from "./providers/AuthProvider";

const Main = () => {
  const [initialLoading, setInitialLoading] = useState(true);
  const { user, authLoading } = useAuth();

  const handleLoadingComplete = () => {
    setInitialLoading(false);
  };

  // Tunggu AuthProvider selesai mengecek sesi yang tersimpan
  if (authLoading) {
    return <LoadingScreen />;
  }

  // Belum login → tampilkan halaman login
  if (!user) {
    return <LoginPage />;
  }

  // Sudah login → tampilkan aplikasi utama
  return (
    <>
      {initialLoading && <LoadingScreen />}
      <App onLoadingComplete={handleLoadingComplete} />
    </>
  );
};

export default Main;
