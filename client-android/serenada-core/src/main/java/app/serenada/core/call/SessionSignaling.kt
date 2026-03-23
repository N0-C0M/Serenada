package app.serenada.core.call

internal interface SessionSignaling {
    interface Listener {
        fun onOpen(activeTransport: String)
        fun onMessage(message: SignalingMessage)
        fun onClosed(reason: String)
    }

    var listener: Listener?
    fun connect(host: String)
    fun isConnected(): Boolean
    fun send(message: SignalingMessage)
    fun close()
    fun recordPong()
}
