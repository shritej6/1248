package app.vision.volunteer.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first

private val Context.sessionDataStore: DataStore<Preferences> by preferencesDataStore(name = "session")

class SessionStore(private val store: DataStore<Preferences>) {
    suspend fun token(): String? = store.data.first()[TOKEN]

    suspend fun session(): Session? {
        val prefs = store.data.first()
        val token = prefs[TOKEN] ?: return null
        val member = prefs[MEMBER] ?: return null
        val roles = prefs[ROLES].orEmpty().split(",").filter { it.isNotEmpty() }
        return Session(token = token, memberId = member, roles = roles)
    }

    suspend fun save(session: Session) {
        store.edit {
            it[TOKEN] = session.token
            it[MEMBER] = session.memberId
            it[ROLES] = session.roles.joinToString(",")
        }
    }

    suspend fun clear() {
        store.edit { it.clear() }
    }

    companion object {
        private val TOKEN = stringPreferencesKey("token")
        private val MEMBER = stringPreferencesKey("member")
        private val ROLES = stringPreferencesKey("roles")

        fun from(context: Context): SessionStore = SessionStore(context.applicationContext.sessionDataStore)
    }
}
