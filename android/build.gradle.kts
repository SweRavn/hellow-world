// Plugins are declared per module (with versions) rather than here: graft-compose needs the Android
// Gradle Plugin and Kotlin Android in the same classloader, and AGP must stay out of the root so that
// graft-core still builds on machines without access to Google's Maven repository.
