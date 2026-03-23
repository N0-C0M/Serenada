package app.serenada.core.network

internal interface SessionAPIClient {
    fun fetchTurnCredentials(host: String, token: String, onResult: (Result<TurnCredentials>) -> Unit)
}
