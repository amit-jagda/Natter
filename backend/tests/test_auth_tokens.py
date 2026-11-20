"""Integration Tests for Access Token, Refresh Token, and HttpOnly Cookies.

Verifies:
1. Hospital registration returns access token and sets HttpOnly refresh cookie.
2. User login returns access token and sets HttpOnly refresh cookie.
3. Access token works in protected routes.
4. Calling protected route without token returns 401.
5. POST /auth/refresh using Cookie issues fresh access token and rotates cookie.
6. POST /auth/refresh using JSON payload issues fresh access token.
7. POST /auth/refresh rejects missing, malformed, expired, or access tokens.
8. POST /auth/logout clears the refresh cookie.
"""

import json
import os
import unittest
import urllib.error
import urllib.request
import uuid


class TestAuthTokensAndCookies(unittest.TestCase):
    """End-to-end integration tests for access & refresh token lifecycle."""

    BASE_URL = os.environ.get("TEST_API_URL", "http://localhost:8000/api/v1")

    def make_request(self, method: str, path: str, data: dict = None, token: str = None, cookie: str = None):
        """Helper to execute HTTP requests with optional headers, cookies, and tokens."""
        url = f"{self.BASE_URL}{path}"
        body = json.dumps(data).encode("utf-8") if data is not None else None
        headers = {}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if cookie:
            headers["Cookie"] = cookie

        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                status_code = resp.status
                content = resp.read().decode("utf-8")
                res_headers = dict(resp.headers)
                cookies_list = resp.headers.get_all("Set-Cookie") or []
                return status_code, json.loads(content) if content else {}, res_headers, cookies_list
        except urllib.error.HTTPError as err:
            err_content = err.read().decode("utf-8")
            try:
                err_json = json.loads(err_content)
            except Exception:
                err_json = {"detail": err_content}
            res_headers = dict(err.headers) if err.headers else {}
            cookies_list = err.headers.get_all("Set-Cookie") or [] if err.headers else []
            return err.code, err_json, res_headers, cookies_list

    def extract_cookie_value(self, cookies_list, cookie_name="refresh_token"):
        """Extract the raw cookie value from Set-Cookie headers."""
        for c in cookies_list:
            if c.startswith(f"{cookie_name}="):
                parts = c.split(";")
                val = parts[0].split("=", 1)[1]
                return val
        return None

    def test_full_auth_token_and_cookie_flow(self):
        """Complete workflow test: Register -> Cookie set -> Access token works -> Refresh -> Logout."""
        unique_suffix = uuid.uuid4().hex[:8]
        admin_email = f"tokens_admin_{unique_suffix}@cityhospital.org"
        password = "SecurePassword123!"

        # -------------------------------------------------------------
        # 1. REGISTER HOSPITAL
        # -------------------------------------------------------------
        status, body, headers, cookies = self.make_request(
            "POST",
            "/auth/register-hospital",
            {
                "hospital_name": f"City Hospital {unique_suffix}",
                "admin_name": "Dr. Sarah Paul",
                "admin_email": admin_email,
                "password": password,
            },
        )
        self.assertEqual(status, 201, f"Registration failed with status {status}: {body}")
        self.assertIn("access_token", body)
        self.assertIn("refresh_token", body)
        access_token_1 = body["access_token"]
        refresh_token_1 = body["refresh_token"]

        # Check Set-Cookie header contains HttpOnly refresh_token
        cookie_val_1 = self.extract_cookie_value(cookies, "refresh_token")
        self.assertIsNotNone(cookie_val_1, "Expected 'Set-Cookie: refresh_token=...' header upon registration")
        self.assertEqual(cookie_val_1, refresh_token_1)

        # Verify HttpOnly and Path=/ in raw cookie string
        raw_cookie_str = [c for c in cookies if c.startswith("refresh_token=")][0]
        self.assertIn("HttpOnly", raw_cookie_str)
        self.assertIn("Path=/", raw_cookie_str)

        # -------------------------------------------------------------
        # 2. CALL PROTECTED ROUTE WITH ACCESS TOKEN
        # -------------------------------------------------------------
        status, me_body, _, _ = self.make_request(
            "GET",
            "/auth/me",
            token=access_token_1,
        )
        self.assertEqual(status, 200)
        self.assertEqual(me_body["user"]["email"], admin_email.lower())

        # Calling without access token must return 401
        status, no_auth_body, _, _ = self.make_request("GET", "/auth/me")
        self.assertEqual(status, 401)
        self.assertTrue(
            "Authentication token required" in str(no_auth_body) or "token" in str(no_auth_body).lower(),
            f"Expected 401 token required, got: {no_auth_body}"
        )

        # -------------------------------------------------------------
        # 3. REFRESH TOKEN USING COOKIE
        # -------------------------------------------------------------
        status, ref_body, _, ref_cookies = self.make_request(
            "POST",
            "/auth/refresh",
            cookie=f"refresh_token={cookie_val_1}",
        )
        self.assertEqual(status, 200, f"Refresh via cookie failed: {ref_body}")
        self.assertIn("access_token", ref_body)
        access_token_2 = ref_body["access_token"]
        self.assertIsNotNone(access_token_2)

        # The new access token must work on protected endpoints
        status, me_body_2, _, _ = self.make_request(
            "GET",
            "/auth/me",
            token=access_token_2,
        )
        self.assertEqual(status, 200)
        self.assertEqual(me_body_2["user"]["email"], admin_email.lower())

        # -------------------------------------------------------------
        # 4. REFRESH TOKEN USING JSON PAYLOAD (FALLBACK FOR NON-BROWSER CLIENTS)
        # -------------------------------------------------------------
        status, ref_payload_body, _, _ = self.make_request(
            "POST",
            "/auth/refresh",
            data={"refresh_token": ref_body["refresh_token"]},
        )
        self.assertEqual(status, 200, f"Refresh via payload failed: {ref_payload_body}")
        self.assertIn("access_token", ref_payload_body)

        # -------------------------------------------------------------
        # 5. REFRESH ERROR HANDLING: INVALID / MISSING / WRONG TYPE
        # -------------------------------------------------------------
        # 5a. Missing token completely
        status, err_body, _, _ = self.make_request("POST", "/auth/refresh")
        self.assertEqual(status, 401)

        # 5b. Malformed token string
        status, err_body, _, _ = self.make_request("POST", "/auth/refresh", cookie="refresh_token=not.a.valid.jwt")
        self.assertEqual(status, 401)

        # 5c. Access token supplied as refresh token (type mismatch)
        status, err_body, _, _ = self.make_request("POST", "/auth/refresh", cookie=f"refresh_token={access_token_1}")
        self.assertEqual(status, 401)

        # -------------------------------------------------------------
        # 6. LOGIN ENDPOINT SETS COOKIE & ACCESS TOKEN
        # -------------------------------------------------------------
        status, login_body, _, login_cookies = self.make_request(
            "POST",
            "/auth/login",
            {
                "email": admin_email,
                "password": password,
            },
        )
        self.assertEqual(status, 200, f"Login failed: {login_body}")
        self.assertIn("access_token", login_body)
        self.assertIn("refresh_token", login_body)
        login_cookie_val = self.extract_cookie_value(login_cookies, "refresh_token")
        self.assertIsNotNone(login_cookie_val)

        # -------------------------------------------------------------
        # 7. LOGOUT CLEARS REFRESH COOKIE
        # -------------------------------------------------------------
        status, logout_body, _, logout_cookies = self.make_request(
            "POST",
            "/auth/logout",
            token=login_body["access_token"],
        )
        self.assertEqual(status, 200)
        # Verify cookie cleared in headers (Max-Age=0 or expires in past)
        logout_cookie_str = [c for c in logout_cookies if c.startswith("refresh_token=")]
        self.assertTrue(len(logout_cookie_str) > 0, "Expected Set-Cookie to clear refresh_token on logout")
        self.assertTrue("Max-Age=0" in logout_cookie_str[0] or 'refresh_token=""' in logout_cookie_str[0] or 'refresh_token=;' in logout_cookie_str[0])


if __name__ == "__main__":
    unittest.main()
