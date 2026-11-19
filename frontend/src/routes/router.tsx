import { createBrowserRouter } from "react-router-dom";
import { RootLayout } from "@/layouts/RootLayout";
import { HomePage } from "@/routes/HomePage";
import { NotFoundPage } from "@/routes/NotFoundPage";
import { VoicePlayground } from "@/features/voice-playground";
import { OnboardingCanvas } from "@/features/onboarding/OnboardingCanvas";
import { HospitalDashboard } from "@/features/hospital/HospitalDashboard";
import { LoginPage } from "@/features/auth/LoginPage";

export const router = createBrowserRouter([
  {
    path: "/onboarding",
    element: <OnboardingCanvas />,
  },
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: "hospital",
        element: <HospitalDashboard />,
      },
      {
        path: "playground",
        element: <VoicePlayground />,
      },
      {
        path: "*",
        element: <NotFoundPage />,
      },
    ],
  },
]);



