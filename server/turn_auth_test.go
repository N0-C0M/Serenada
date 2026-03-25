package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestIssueTurnTokenRoundTrip(t *testing.T) {
	t.Setenv("TURN_TOKEN_SECRET", "test-secret-1234")

	token, expiresAt, err := issueTurnToken(10*time.Minute, turnTokenKindCall)
	if err != nil {
		t.Fatalf("issueTurnToken: %v", err)
	}
	if token == "" {
		t.Fatalf("expected non-empty token")
	}
	if expiresAt.IsZero() {
		t.Fatalf("expected non-zero expiry")
	}

	claims, ok := parseTurnToken(token)
	if !ok {
		t.Fatalf("parseTurnToken failed on valid token")
	}
	if claims.V != turnTokenVersion {
		t.Fatalf("expected version %d, got %d", turnTokenVersion, claims.V)
	}
	if claims.Kind != turnTokenKindCall {
		t.Fatalf("expected kind %q, got %q", turnTokenKindCall, claims.Kind)
	}
}

func TestParseTurnTokenMalformedNoDot(t *testing.T) {
	t.Setenv("TURN_TOKEN_SECRET", "test-secret-1234")

	_, ok := parseTurnToken("nodothere")
	if ok {
		t.Fatalf("expected parse to fail for token without dot separator")
	}
}

func TestParseTurnTokenMalformedBadBase64(t *testing.T) {
	t.Setenv("TURN_TOKEN_SECRET", "test-secret-1234")

	_, ok := parseTurnToken("!!!invalid!!!.!!!base64!!!")
	if ok {
		t.Fatalf("expected parse to fail for invalid base64")
	}
}

func TestParseTurnTokenTamperedSignature(t *testing.T) {
	t.Setenv("TURN_TOKEN_SECRET", "test-secret-1234")

	token, _, err := issueTurnToken(10*time.Minute, turnTokenKindCall)
	if err != nil {
		t.Fatalf("issueTurnToken: %v", err)
	}

	parts := strings.Split(token, ".")
	tampered := parts[0] + ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	_, ok := parseTurnToken(tampered)
	if ok {
		t.Fatalf("expected parse to fail for tampered signature")
	}
}

func TestValidateTurnTokenCallKind(t *testing.T) {
	t.Setenv("TURN_TOKEN_SECRET", "test-secret-1234")

	token, _, err := issueTurnToken(10*time.Minute, turnTokenKindCall)
	if err != nil {
		t.Fatalf("issueTurnToken: %v", err)
	}
	if !validateTurnToken(token, turnTokenKindCall) {
		t.Fatalf("expected valid call token to pass validation")
	}
}

func TestValidateTurnTokenDiagnosticKind(t *testing.T) {
	t.Setenv("TURN_TOKEN_SECRET", "test-secret-1234")

	token, _, err := issueTurnToken(5*time.Second, turnTokenKindDiagnostic)
	if err != nil {
		t.Fatalf("issueTurnToken: %v", err)
	}
	if !validateTurnToken(token, turnTokenKindDiagnostic) {
		t.Fatalf("expected valid diagnostic token to pass validation")
	}
}

func TestValidateTurnTokenWrongKind(t *testing.T) {
	t.Setenv("TURN_TOKEN_SECRET", "test-secret-1234")

	token, _, err := issueTurnToken(10*time.Minute, turnTokenKindCall)
	if err != nil {
		t.Fatalf("issueTurnToken: %v", err)
	}
	if validateTurnToken(token, turnTokenKindDiagnostic) {
		t.Fatalf("expected call token to fail validation as diagnostic")
	}
}

func TestValidateTurnTokenMissingSecret(t *testing.T) {
	_, _, err := issueTurnToken(10*time.Minute, turnTokenKindCall)
	if err == nil {
		t.Fatalf("expected error when secret is missing")
	}
}

func TestHandleTurnCredentialsMissingToken(t *testing.T) {
	t.Setenv("TURN_TOKEN_SECRET", "test-secret-1234")

	handler := handleTurnCredentials()
	req := httptest.NewRequest(http.MethodGet, "/api/turn-credentials", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandleTurnCredentialsInvalidToken(t *testing.T) {
	t.Setenv("TURN_TOKEN_SECRET", "test-secret-1234")

	handler := handleTurnCredentials()
	req := httptest.NewRequest(http.MethodGet, "/api/turn-credentials?token=bogus", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandleTurnCredentialsValidCallToken(t *testing.T) {
	t.Setenv("TURN_TOKEN_SECRET", "test-secret-1234")
	t.Setenv("TURN_SECRET", "coturn-secret")
	t.Setenv("STUN_HOST", "stun.example.com")

	token, _, err := issueTurnToken(10*time.Minute, turnTokenKindCall)
	if err != nil {
		t.Fatalf("issueTurnToken: %v", err)
	}

	handler := handleTurnCredentials()
	req := httptest.NewRequest(http.MethodGet, "/api/turn-credentials?token="+token, nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var config TurnConfig
	if err := json.NewDecoder(w.Body).Decode(&config); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if config.Username == "" || config.Password == "" {
		t.Fatalf("expected non-empty credentials")
	}
	if config.TTL != 15*60 {
		t.Fatalf("expected TTL=900 for call token, got %d", config.TTL)
	}
	if len(config.URIs) == 0 {
		t.Fatalf("expected non-empty URIs")
	}
}

func TestHandleTurnCredentialsDiagnosticTokenShortTTL(t *testing.T) {
	t.Setenv("TURN_TOKEN_SECRET", "test-secret-1234")
	t.Setenv("TURN_SECRET", "coturn-secret")
	t.Setenv("STUN_HOST", "stun.example.com")

	token, _, err := issueTurnToken(30*time.Second, turnTokenKindDiagnostic)
	if err != nil {
		t.Fatalf("issueTurnToken: %v", err)
	}

	handler := handleTurnCredentials()
	req := httptest.NewRequest(http.MethodGet, "/api/turn-credentials?token="+token, nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var config TurnConfig
	if err := json.NewDecoder(w.Body).Decode(&config); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if config.TTL != 5 {
		t.Fatalf("expected TTL=5 for diagnostic token, got %d", config.TTL)
	}
}

func TestHandleTurnCredentialsWrongMethod(t *testing.T) {
	handler := handleTurnCredentials()
	req := httptest.NewRequest(http.MethodPost, "/api/turn-credentials", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", w.Code)
	}
}

func TestHandleTurnCredentialsMissingSTUN(t *testing.T) {
	t.Setenv("TURN_TOKEN_SECRET", "test-secret-1234")
	t.Setenv("TURN_SECRET", "coturn-secret")
	// STUN_HOST not set

	token, _, err := issueTurnToken(10*time.Minute, turnTokenKindCall)
	if err != nil {
		t.Fatalf("issueTurnToken: %v", err)
	}

	handler := handleTurnCredentials()
	req := httptest.NewRequest(http.MethodGet, "/api/turn-credentials?token="+token, nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
}

func TestHandleDiagnosticTokenSuccess(t *testing.T) {
	t.Setenv("TURN_TOKEN_SECRET", "test-secret-1234")

	handler := handleDiagnosticToken()
	req := httptest.NewRequest(http.MethodPost, "/api/diagnostic-token", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["token"] == nil || resp["token"] == "" {
		t.Fatalf("expected non-empty token in response")
	}
	if resp["expires"] == nil {
		t.Fatalf("expected expires in response")
	}
}

func TestHandleDiagnosticTokenWrongMethod(t *testing.T) {
	handler := handleDiagnosticToken()
	req := httptest.NewRequest(http.MethodPut, "/api/diagnostic-token", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", w.Code)
	}
}

func TestHandleDiagnosticTokenMissingSecret(t *testing.T) {
	handler := handleDiagnosticToken()
	req := httptest.NewRequest(http.MethodPost, "/api/diagnostic-token", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
}
