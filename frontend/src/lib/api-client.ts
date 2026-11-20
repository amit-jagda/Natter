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

  private async handleResponse<T>(response: Response): Promise<T> {
    if (response.status === 204) {
      return {} as T;
    }
    if (!response.ok) {
      let errorData: unknown;
      let message = `Request failed with status ${response.status}`;
      try {
        errorData = await response.json();
        if (typeof errorData === "object" && errorData !== null && "detail" in errorData) {
          message = String((errorData as { detail: unknown }).detail);
        } else if (typeof errorData === "object" && errorData !== null && "message" in errorData) {
          message = String((errorData as { message: unknown }).message);
        }
      } catch {
        // Response was not JSON
      }
      throw new APIClientError(message, response.status, errorData);
    }
    return response.json() as Promise<T>;
  }

  async get<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      method: "GET",
      headers: this.getHeaders(),
    });
    return this.handleResponse<T>(response);
  }

  async post<T>(url: string, data?: unknown): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: this.getHeaders({ "Content-Type": "application/json" }),
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
    return this.handleResponse<T>(response);
  }

  async put<T>(url: string, data?: unknown): Promise<T> {
    const response = await fetch(url, {
      method: "PUT",
      headers: this.getHeaders({ "Content-Type": "application/json" }),
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
    return this.handleResponse<T>(response);
  }

  async delete<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      method: "DELETE",
      headers: this.getHeaders(),
    });
    return this.handleResponse<T>(response);
  }

  async uploadForm<T>(url: string, formData: FormData): Promise<T> {
    const headers = this.getHeaders();
    delete headers["Content-Type"]; // Let browser set boundary
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    });
    return this.handleResponse<T>(response);
  }
}

export const apiClient = new APIClient();
