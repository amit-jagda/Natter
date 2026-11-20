export class APIClientError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "APIClientError";
    this.status = status;
    this.data = data;
  }
}

class APIClient {
  private isRefreshing = false;

  private getHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...customHeaders,
    };
    const token = this.getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }

  setToken(token: string) {
    try {
      localStorage.setItem("auth_token", token);
    } catch {
      // Ignore if localStorage unavailable
    }
  }

  getToken(): string | null {
    try {
      return localStorage.getItem("auth_token");
    } catch {
      return null;
    }
  }

  removeToken() {
    try {
      localStorage.removeItem("auth_token");
    } catch {
      // Ignore
    }
  }

  async refreshToken(): Promise<string | null> {
    if (this.isRefreshing) return null;
    this.isRefreshing = true;
    try {
      const response = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        credentials: "include",
      });
      if (!response.ok) {
        this.removeToken();
        return null;
      }
      const data = await response.json();
      if (data && typeof data.access_token === "string") {
        this.setToken(data.access_token);
        return data.access_token;
      }
      return null;
    } catch {
      return null;
    } finally {
      this.isRefreshing = false;
    }
  }

  async logout(): Promise<void> {
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: this.getHeaders(),
        credentials: "include",
      });
    } catch {
      // Ignore
    } finally {
      this.removeToken();
    }
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (response.status === 204) {
      return {} as T;
    }
    if (!response.ok) {
      let errorData: unknown;
      let message = `Request failed with status ${response.status}`;
      try {
        errorData = await response.json();
        if (typeof errorData === "object" && errorData !== null) {
          const typedObj = errorData as Record<string, unknown>;
          if (typedObj.error && typeof typedObj.error === "object") {
            const err = typedObj.error as Record<string, unknown>;
            if (typeof err.message === "string") {
              message = err.message;
            }
          } else if (typeof typedObj.detail === "string") {
            message = typedObj.detail;
          } else if (Array.isArray(typedObj.detail) && typedObj.detail.length > 0) {
            const first = typedObj.detail[0] as Record<string, unknown>;
            message = typeof first.msg === "string" ? first.msg : JSON.stringify(first);
          } else if (typeof typedObj.message === "string") {
            message = typedObj.message;
          }
        }
      } catch {
        // Response was not JSON
      }

      if (response.status === 401) {
        this.removeToken();
        if (!message || message.toLowerCase().includes("token")) {
          message = "Your session has expired or authentication token is missing. Please log in again.";
        }
      }

      throw new APIClientError(message, response.status, errorData);
    }
    return response.json() as Promise<T>;
  }

  async get<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      method: "GET",
      headers: this.getHeaders(),
      credentials: "include",
    });

    if (response.status === 401 && !url.includes("/auth/")) {
      const newToken = await this.refreshToken();
      if (newToken) {
        const retryResponse = await fetch(url, {
          method: "GET",
          headers: this.getHeaders(),
          credentials: "include",
        });
        return this.handleResponse<T>(retryResponse);
      }
    }

    return this.handleResponse<T>(response);
  }

  async post<T>(url: string, data?: unknown): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: this.getHeaders({ "Content-Type": "application/json" }),
      body: data !== undefined ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    if (response.status === 401 && !url.includes("/auth/")) {
      const newToken = await this.refreshToken();
      if (newToken) {
        const retryResponse = await fetch(url, {
          method: "POST",
          headers: this.getHeaders({ "Content-Type": "application/json" }),
          body: data !== undefined ? JSON.stringify(data) : undefined,
          credentials: "include",
        });
        return this.handleResponse<T>(retryResponse);
      }
    }

    return this.handleResponse<T>(response);
  }

  async put<T>(url: string, data?: unknown): Promise<T> {
    const response = await fetch(url, {
      method: "PUT",
      headers: this.getHeaders({ "Content-Type": "application/json" }),
      body: data !== undefined ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    if (response.status === 401 && !url.includes("/auth/")) {
      const newToken = await this.refreshToken();
      if (newToken) {
        const retryResponse = await fetch(url, {
          method: "PUT",
          headers: this.getHeaders({ "Content-Type": "application/json" }),
          body: data !== undefined ? JSON.stringify(data) : undefined,
          credentials: "include",
        });
        return this.handleResponse<T>(retryResponse);
      }
    }

    return this.handleResponse<T>(response);
  }

  async patch<T>(url: string, data?: unknown): Promise<T> {
    const response = await fetch(url, {
      method: "PATCH",
      headers: this.getHeaders({ "Content-Type": "application/json" }),
      body: data !== undefined ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    if (response.status === 401 && !url.includes("/auth/")) {
      const newToken = await this.refreshToken();
      if (newToken) {
        const retryResponse = await fetch(url, {
          method: "PATCH",
          headers: this.getHeaders({ "Content-Type": "application/json" }),
          body: data !== undefined ? JSON.stringify(data) : undefined,
          credentials: "include",
        });
        return this.handleResponse<T>(retryResponse);
      }
    }

    return this.handleResponse<T>(response);
  }

  async delete<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      method: "DELETE",
      headers: this.getHeaders(),
      credentials: "include",
    });

    if (response.status === 401 && !url.includes("/auth/")) {
      const newToken = await this.refreshToken();
      if (newToken) {
        const retryResponse = await fetch(url, {
          method: "DELETE",
          headers: this.getHeaders(),
          credentials: "include",
        });
        return this.handleResponse<T>(retryResponse);
      }
    }

    return this.handleResponse<T>(response);
  }

  async uploadForm<T>(url: string, formData: FormData): Promise<T> {
    const headers = this.getHeaders();
    delete headers["Content-Type"]; // Let browser set boundary
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
      credentials: "include",
    });
    return this.handleResponse<T>(response);
  }
}

export const apiClient = new APIClient();
