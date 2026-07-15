"""Microsoft Entra ID authorization-code flow helpers."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from app.core.config import Settings


DEFAULT_SCOPES = ("openid", "profile", "email", "User.Read")
_HTTP_TIMEOUT = httpx.Timeout(20.0)


class MicrosoftAuthError(RuntimeError):
    """Raised when Microsoft sign-in cannot be completed."""


@dataclass(frozen=True)
class MicrosoftAuthConfig:
    tenant_id: str
    client_id: str
    client_secret: str
    redirect_uri: str

    @property
    def is_configured(self) -> bool:
        return bool(self.tenant_id and self.client_id and self.client_secret)

    @property
    def authorize_endpoint(self) -> str:
        return (
            f"https://login.microsoftonline.com/{self.tenant_id}"
            "/oauth2/v2.0/authorize"
        )

    @property
    def token_endpoint(self) -> str:
        return (
            f"https://login.microsoftonline.com/{self.tenant_id}"
            "/oauth2/v2.0/token"
        )


def build_config(settings: Settings, *, redirect_uri: str) -> MicrosoftAuthConfig:
    return MicrosoftAuthConfig(
        tenant_id=settings.microsoft_tenant_id.strip(),
        client_id=settings.microsoft_client_id.strip(),
        client_secret=settings.microsoft_client_secret.strip(),
        redirect_uri=settings.microsoft_redirect_uri.strip() or redirect_uri,
    )


def authorize_url(config: MicrosoftAuthConfig, *, state: str) -> str:
    params = {
        "client_id": config.client_id,
        "response_type": "code",
        "redirect_uri": config.redirect_uri,
        "response_mode": "query",
        "scope": " ".join(DEFAULT_SCOPES),
        "state": state,
        "prompt": "select_account",
    }
    return f"{config.authorize_endpoint}?{urlencode(params)}"


async def exchange_code_for_token(config: MicrosoftAuthConfig, *, code: str) -> str:
    data = {
        "client_id": config.client_id,
        "client_secret": config.client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": config.redirect_uri,
    }
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        try:
            response = await client.post(config.token_endpoint, data=data)
        except httpx.HTTPError as exc:
            raise MicrosoftAuthError("No fue posible conectar con Microsoft.") from exc

    payload = _safe_json(response)
    access_token = payload.get("access_token")
    if response.status_code >= 400 or not access_token:
        detail = (
            payload.get("error_description")
            or payload.get("error")
            or "No se pudo obtener el token."
        )
        raise MicrosoftAuthError(f"Fallo la autenticacion con Microsoft: {detail}")
    return str(access_token)


async def fetch_user_email(access_token: str) -> str:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
    }
    url = (
        "https://graph.microsoft.com/v1.0/me"
        "?$select=mail,userPrincipalName,displayName,id"
    )
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        try:
            response = await client.get(url, headers=headers)
        except httpx.HTTPError as exc:
            raise MicrosoftAuthError(
                "No fue posible leer el perfil desde Microsoft."
            ) from exc

    payload = _safe_json(response)
    if response.status_code >= 400:
        error = payload.get("error")
        detail = error.get("message") if isinstance(error, dict) else None
        raise MicrosoftAuthError(
            "Fallo la lectura del perfil de Microsoft: "
            f"{detail or 'respuesta invalida.'}"
        )

    email = str(payload.get("mail") or payload.get("userPrincipalName") or "").strip()
    if not email:
        raise MicrosoftAuthError(
            "Tu cuenta Microsoft no entrego un correo utilizable para el ingreso."
        )
    return email


def _safe_json(response: httpx.Response) -> dict:
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}
