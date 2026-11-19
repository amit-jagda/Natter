export const env = {
  APP_ENV: import.meta.env.MODE || "development",
  API_URL: import.meta.env.VITE_API_URL || "",
};
