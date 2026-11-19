import { createBrowserRouter } from "react-router-dom";
import { RootLayout } from "@/layouts/RootLayout";
import { HomePage } from "@/routes/HomePage";
import { NotFoundPage } from "@/routes/NotFoundPage";
import { VoicePlayground } from "@/features/voice-playground";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <HomePage />,
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


