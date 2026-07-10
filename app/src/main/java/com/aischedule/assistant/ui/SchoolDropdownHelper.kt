package com.aischedule.assistant.ui

import android.widget.ArrayAdapter
import android.widget.AutoCompleteTextView
import com.aischedule.assistant.R
import com.google.android.material.textfield.TextInputLayout

object SchoolDropdownHelper {
    fun setup(
        dropdownLayout: TextInputLayout,
        autoComplete: AutoCompleteTextView,
        onSelected: (FixedSchoolCatalog.Entry) -> Unit
    ) {
        val context = autoComplete.context
        val adapter = ArrayAdapter(
            context,
            android.R.layout.simple_dropdown_item_1line,
            FixedSchoolCatalog.displayNames
        )
        autoComplete.setAdapter(adapter)
        autoComplete.inputType = android.text.InputType.TYPE_NULL
        autoComplete.keyListener = null

        autoComplete.setOnItemClickListener { _, _, position, _ ->
            val entry = FixedSchoolCatalog.entries.getOrNull(position) ?: return@setOnItemClickListener
            onSelected(entry)
        }

        dropdownLayout.hint = context.getString(R.string.school_select_hint)
    }
}
