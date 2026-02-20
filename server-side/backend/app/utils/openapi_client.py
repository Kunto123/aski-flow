import logging
from typing import Optional
import requests
import eventlet


class Client:

    def __init__(
        self,
        api_token: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout_ms: int = None,
        **kwargs,
    ) -> None:
        super().__init__()

        self._api_token = api_token
        self._base_url = base_url
        self._timeout_ms = timeout_ms
        self._client_kwargs = kwargs

    def post(
        self,
        path: str,
        data: Optional[dict] = None,
        files: Optional[dict] = {"none": (None, "")},
        content_type: str = None,
        accept: str = "application/json",
        **kwargs,
    ) -> dict:
        headers = {
            "Authorization": f"Bearer {self._api_token}",
            "Accept": accept,
        }

        if files:
            response = requests.post(
                f"{self._base_url}{path}",
                headers=headers,
                files=files,
                data=data,
                timeout=self._timeout_ms,
                **self._client_kwargs,
                **kwargs,
            )
        else:
            logging.info("JSON BOI")
            response = requests.post(
                f"{self._base_url}{path}",
                headers=headers,
                json=data,
                timeout=self._timeout_ms,
                **self._client_kwargs,
                **kwargs,
            )
        if response.status_code == 200:
            if accept == "application/json":
                return response.json()
            elif accept == "image/*":
                return response.content
            else:
                return response.content
        else:
            raise Exception(response.text)

    def get(
        self,
        path: str,
        content_type: str = None,
        accept: str = "application/json",
        **kwargs,
    ) -> dict:
        response = requests.get(
            f"{self._base_url}{path}",
            headers={
                "Content-Type": content_type,
                "Authorization": f"Bearer {self._api_token}",
                "Accept": accept,
            },
            timeout=self._timeout_ms,
            **self._client_kwargs,
            **kwargs,
        )

        if response.status_code == 200:
            if accept == "application/json":
                return response.json()
            elif accept == "image/*":
                return response.content
            else:
                return response.content
        else:
            print(response.status_code)
            if response.json()["status"] == "in-progress":
                return response.json()
            raise Exception(str(response.json()))

    def pooling(
        self,
        path: str,
        content_type: str = None,
        accept: str = "application/json",
        **kwargs,
    ) -> dict:
        pooling_response = self.get(path=path, accept=accept)
        while (
            isinstance(pooling_response, dict)
            and pooling_response.get("status") == "in-progress"
        ):
            print("Pooling...")
            eventlet.sleep(0.5)
            pooling_response = self.get(path=path, accept=accept)
        return pooling_response

