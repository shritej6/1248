package app.vision.volunteer.data

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

@Serializable(with = ErrorCodeSerializer::class)
enum class ErrorCode(val wire: String) {
    Invalid("invalid"),
    TooLarge("too_large"),
    Unauthorized("unauthorized"),
    Forbidden("forbidden"),
    NotFound("not_found"),
    WrongState("wrong_state"),
    Taken("taken"),
    NotEligible("not_eligible"),
    TooManyJobs("too_many_jobs"),
    NotEarned("not_earned"),
    DemoOff("demo_off"),
    RateLimited("rate_limited"),
    Internal("internal"),
    Network("network"),
    ;

    companion object {
        fun fromWire(wire: String): ErrorCode =
            entries.firstOrNull { it.wire == wire && it != Network } ?: Invalid
    }
}

object ErrorCodeSerializer : KSerializer<ErrorCode> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("ErrorCode", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: ErrorCode) = encoder.encodeString(value.wire)

    override fun deserialize(decoder: Decoder): ErrorCode = ErrorCode.fromWire(decoder.decodeString())
}
