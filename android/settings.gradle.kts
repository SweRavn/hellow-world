pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "graft-android"

// Pure Kotlin/JVM: spec model, expression engine, validator, Graft engine. Builds anywhere.
include(":graft-core")

// Jetpack Compose renderer + UI. Needs the Android SDK (ANDROID_HOME or local.properties sdk.dir).
val hasAndroidSdk = System.getenv("ANDROID_HOME") != null ||
    file("local.properties").let { it.exists() && it.readText().contains("sdk.dir") }
if (hasAndroidSdk) include(":graft-compose")
