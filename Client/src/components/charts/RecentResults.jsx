import React from 'react'

const RecentResults = () => {
    return (
        < div className="mt-5 rounded-xl border border-(--border) bg-(--surface-secondary) p-5" >
            <div className="mb-5 flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-(--foreground)">
                        Recent results
                    </p>
                    <p className="mt-1 text-xs text-(--muted)">
                        Latest published academic results
                    </p>
                </div>
                <button className="text-xs font-medium text-(--primary) transition-colors hover:text-(--primary-deep)">
                    View all
                </button>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-150 text-left">
                    <thead>
                        <tr className="border-b border-(--border)">
                            <th className="pb-3 text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-foreground)">
                                Student
                            </th>
                            <th className="pb-3 text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-foreground)">
                                Course
                            </th>
                            <th className="pb-3 text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-foreground)">
                                Score
                            </th>
                            <th className="pb-3 text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-foreground)">
                                Status
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr className="border-b border-(--border-subtle)">
                            <td className="py-4 text-sm text-(--foreground)">
                                Ayaan Khan
                            </td>
                            <td className="py-4 text-sm text-(--muted)">
                                Computer Science
                            </td>
                            <td className="py-4 text-sm font-medium tabular text-(--foreground)">
                                92%
                            </td>
                            <td className="py-4">
                                <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-medium text-emerald-400">
                                    Published
                                </span>
                            </td>
                        </tr>
                        <tr className="border-b border-(--border-subtle)">
                            <td className="py-4 text-sm text-(--foreground)">
                                Sara Ahmed
                            </td>
                            <td className="py-4 text-sm text-(--muted)">
                                Information Technology
                            </td>
                            <td className="py-4 text-sm font-medium tabular text-(--foreground)">
                                87%
                            </td>
                            <td className="py-4">
                                <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-medium text-emerald-400">
                                    Published
                                </span>
                            </td>
                        </tr>
                        <tr>
                            <td className="pt-4 text-sm text-(--foreground)">
                                Rayyan Ali
                            </td>
                            <td className="pt-4 text-sm text-(--muted)">
                                Computer Science
                            </td>
                            <td className="pt-4 text-sm font-medium tabular text-(--foreground)">
                                81%
                            </td>
                            <td className="pt-4">
                                <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[10px] font-medium text-amber-400">
                                    Pending
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    )
}

export default RecentResults
