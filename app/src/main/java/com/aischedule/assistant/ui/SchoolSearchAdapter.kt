package com.aischedule.assistant.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.aischedule.assistant.databinding.ItemSchoolSearchBinding
import com.aischedule.assistant.network.SchoolSearchItem

class SchoolSearchAdapter(
    private val onItemClick: (SchoolSearchItem) -> Unit
) : RecyclerView.Adapter<SchoolSearchAdapter.SchoolViewHolder>() {

    private val items = mutableListOf<SchoolSearchItem>()

    fun submitList(schools: List<SchoolSearchItem>) {
        items.clear()
        items.addAll(schools)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): SchoolViewHolder {
        val binding = ItemSchoolSearchBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return SchoolViewHolder(binding)
    }

    override fun onBindViewHolder(holder: SchoolViewHolder, position: Int) {
        holder.bind(items[position])
    }

    override fun getItemCount(): Int = items.size

    inner class SchoolViewHolder(
        private val binding: ItemSchoolSearchBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(item: SchoolSearchItem) {
            binding.tvSchoolName.text = item.name
            binding.tvSchoolRegion.text = item.region.ifBlank { "지역 정보 없음" }
            binding.root.setOnClickListener { onItemClick(item) }
        }
    }
}
