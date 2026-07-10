package com.aischedule.assistant.ui

import com.aischedule.assistant.network.SchoolSearchItem

object FixedSchoolCatalog {
    data class Entry(
        val shortName: String,
        val code: Int,
        val name: String,
        val region: String
    ) {
        fun toSchoolItem(): SchoolSearchItem = SchoolSearchItem(code, name, region)
    }

    val entries: List<Entry> = listOf(
        Entry("부곡", 1688, "부곡여자중학교", "부산광역시"),
        Entry("유락", 1952, "유락여자중학교", "부산광역시"),
        Entry("동해", 12485, "동해중학교", "부산광역시"),
        Entry("동래", 1588, "동래중학교", "부산광역시")
    )

    val displayNames: List<String> = entries.map { it.shortName }

    fun findByShortName(shortName: String): Entry? =
        entries.find { it.shortName == shortName }

    fun findByCode(code: Int): Entry? =
        entries.find { it.code == code }
}
