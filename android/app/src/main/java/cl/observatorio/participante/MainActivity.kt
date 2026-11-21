package cl.observatorio.participante

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { HelloScreen() } }
    }
}

@Composable
fun HelloScreen() {
    var backend by remember { mutableStateOf("consultando…") }
    LaunchedEffect(Unit) { backend = fetchHealth() }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Observatorio — participante", style = MaterialTheme.typography.headlineSmall)
        Text("Backend (${BuildConfig.API_BASE_URL}): $backend")
    }
}

private suspend fun fetchHealth(): String = withContext(Dispatchers.IO) {
    try {
        val conn = URL("${BuildConfig.API_BASE_URL}/api/health").openConnection() as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 60_000 // Render free plan cold start takes 30–60 s
        try {
            val stream = if (conn.responseCode < 400) conn.inputStream else conn.errorStream
            "${conn.responseCode} ${stream.bufferedReader().readText()}"
        } finally {
            conn.disconnect()
        }
    } catch (e: Exception) {
        "error: ${e.message}"
    }
}
