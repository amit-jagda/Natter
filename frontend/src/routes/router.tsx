import { createBrowserRouter, Navigate } from "react-router-dom";
import { RootLayout } from "@/layouts/RootLayout";
import { HomePage } from "@/routes/HomePage";
import { NotFoundPage } from "@/routes/NotFoundPage";
import { VoicePlayground } from "@/features/voice-playground";
import { HospitalDashboard } from "@/features/hospital/HospitalDashboard";
import { LoginPage } from "@/features/auth/LoginPage";
import { RegisterPage } from "@/features/auth/RegisterPage";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export const router = createBrowserRouter([
  {
    path: "/register",
    element: <RegisterPage />,
  },
  {
    path: "/onboarding",
    element: <Navigate to="/register" replace />,
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
        element: (
          <ProtectedRoute>
            <HospitalDashboard />
          </ProtectedRoute>
        ),
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
