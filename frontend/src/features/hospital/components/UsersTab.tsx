import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Users,
  UserPlus,
  Search,
  Shield,
  ShieldAlert,
  Trash2,
  Edit3,
  Loader2,
  Key,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Copy,
  Info,
  RefreshCw,
  Filter,
} from "lucide-react";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { User, UserRole, UserInvitePayload, UserUpdatePayload } from "@/types/user";
import { apiClient } from "@/lib/api-client";

interface UsersTabProps {
  currentUserRole?: UserRole;
  isOperator?: boolean;
  currentUserId?: string;
  hospitalName?: string;
  showToast?: (msg: string) => void;
  portalContainer?: HTMLElement | null;
}

export const UsersTab: React.FC<UsersTabProps> = ({
  currentUserRole = "admin",
  isOperator: isOperatorProp,
  currentUserId,
  hospitalName = "Hospital",
  showToast,
  portalContainer,
}) => {
  const isOperator = isOperatorProp !== undefined ? isOperatorProp : currentUserRole === "operator";

  // State
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Invite / Create Modal State
  const [isInviteModalOpen, setIsInviteModalOpen] = useState<boolean>(false);
  const [inviteForm, setInviteForm] = useState<UserInvitePayload>({
    email: "",
    full_name: "",
    role: "operator",
    password: "",
  });
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [inviteSubmitting, setInviteSubmitting] = useState<boolean>(false);
  const [inviteResult, setInviteResult] = useState<{
    success: boolean;
    user?: User;
    tempPassword?: string;
    emailSent?: boolean;
    note?: string;
  } | null>(null);

  // Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<{
    full_name: string;
    role: UserRole;
    status: "active" | "suspended" | "inactive";
    password?: string;
  }>({
    full_name: "",
    role: "operator",
    status: "active",
    password: "",
  });
  const [editShowPassword, setEditShowPassword] = useState<boolean>(false);
  const [editSubmitting, setEditSubmitting] = useState<boolean>(false);

  // Delete State
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<{ id: string; email: string; full_name?: string } | null>(null);

  // Helper to generate a strong random password
  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
    let pwd = "";
    for (let i = 0; i < 10; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pwd;
  };

  // Debounced search for backend integration
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 350);
    return () => clearTimeout(handler);
  }, [search]);

  // Fetch users with backend search and role filter
  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (roleFilter !== "all") params.set("role", roleFilter);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const data = await apiClient.get<User[]>(`/api/v1/users${qs}`);
      setUsers(data || []);
    } catch (err: unknown) {
      console.error("Failed to load users", err);
      const msg = err instanceof Error ? err.message : "Failed to fetch user list";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [debouncedSearch, roleFilter]);

  const handleGeneratePasswordForInvite = () => {
    setInviteForm((prev) => ({ ...prev, password: generatePassword() }));
    setShowPassword(true);
  };

  const handleGeneratePasswordForEdit = () => {
    setEditForm((prev) => ({ ...prev, password: generatePassword() }));
    setEditShowPassword(true);
  };

  // Open Invite Modal
  const handleOpenInviteModal = () => {
    setInviteForm({
      email: "",
      full_name: "",
      role: "operator",
      password: generatePassword(),
    });
    setShowPassword(true);
    setInviteResult(null);
    setIsInviteModalOpen(true);
  };

  // Handle Invite / Create User Submit
  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteForm.email) return;

    setInviteSubmitting(true);
    setError(null);
    try {
      const response = await apiClient.post<any>("/api/v1/users/invite", inviteForm);
      setInviteResult({
        success: true,
        user: response.user,
        tempPassword: response.temp_password || response.temporary_password || inviteForm.password,
        emailSent: response.email_sent,
        note: response.message,
      });
      fetchUsers();
      const msg = `User ${inviteForm.email} allocated successfully!`;
      setSuccessMessage(msg);
      showToast?.(msg);
    } catch (err: unknown) {
      console.error("Invite error", err);
      const msg = err instanceof Error ? err.message : "Failed to create / invite user";
      setError(msg);
    } finally {
      setInviteSubmitting(false);
    }
  };

  // Open Edit Modal
  const handleOpenEditModal = (targetUser: User) => {
    setEditingUser(targetUser);
    setEditForm({
      full_name: targetUser.full_name || "",
      role: targetUser.role,
      status: (targetUser.status as any) || "active",
      password: "",
    });
    setEditShowPassword(false);
    setIsEditModalOpen(true);
  };

  // Handle Edit Submit (PATCH)
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    setEditSubmitting(true);
    setError(null);
    try {
      const payload: UserUpdatePayload = {
        full_name: editForm.full_name,
        role: editForm.role,
        status: editForm.status,
      };
      if (editForm.password && editForm.password.trim()) {
        payload.password = editForm.password.trim();
      }

      await apiClient.patch(`/api/v1/users/${editingUser.id}`, payload);
      const editMsg = `User ${editingUser.email} updated successfully!`;
      setSuccessMessage(editMsg);
      showToast?.(editMsg);
      setIsEditModalOpen(false);
      setEditingUser(null);
      fetchUsers();
    } catch (err: unknown) {
      console.error("User update error", err);
      const msg = err instanceof Error ? err.message : "Failed to update user";
      setError(msg);
    } finally {
      setEditSubmitting(false);
    }
  };

  // Handle Delete User Request (opens confirmation modal)
  const handleRequestDelete = (u: User) => {
    if (currentUserId && currentUserId === u.id) {
      const msg = "You cannot delete your own active administrator account.";
      setError(msg);
      showToast?.(msg);
      return;
    }
    setUserToDelete({ id: u.id, email: u.email, full_name: u.full_name });
  };

  // Confirm and Execute User Deletion
  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    setDeletingUserId(userToDelete.id);
    setError(null);
    try {
      await apiClient.delete(`/api/v1/users/${userToDelete.id}`);
      const delMsg = `User ${userToDelete.email} removed successfully.`;
      setSuccessMessage(delMsg);
      showToast?.(delMsg);
      setUserToDelete(null);
      fetchUsers();
    } catch (err: unknown) {
      console.error("Delete error", err);
      const msg = err instanceof Error ? err.message : "Failed to delete user";
      setError(msg);
    } finally {
      setDeletingUserId(null);
    }
  };

  // Copy helper
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    if (showToast) {
      showToast("Credentials copied to clipboard");
    } else {
      alert("Copied to clipboard!");
    }
  };

  // Filtered users
  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.full_name && u.full_name.toLowerCase().includes(search.toLowerCase()));
    const matchesRole = roleFilter === "all" || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const portalTarget =
    portalContainer || (typeof document !== "undefined" ? document.getElementById("header-actions-portal") : null);

  const headerActionsContent = (
    <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
      <button
        type="button"
        onClick={fetchUsers}
        disabled={loading}
        className="p-2.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347] bg-[#fcfaff] dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 text-[#150f26] dark:text-white text-xs font-semibold transition-all disabled:opacity-40 cursor-pointer"
        title="Refresh Staff List"
      >
        <RefreshCw className={`h-4 w-4 text-[#7c3aed] ${loading ? "animate-spin" : ""}`} />
      </button>

      {!isOperator && (
        <button
          type="button"
          onClick={handleOpenInviteModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-[#7c3aed] to-[#9333ea] text-white hover:brightness-105 shadow-md shadow-purple-600/30 transition-all cursor-pointer"
        >
          <UserPlus className="h-4 w-4" />
          <span>Invite / Add User</span>
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Portal render for main header actions */}
      {portalTarget && createPortal(headerActionsContent, portalTarget)}

      {/* Operator View-Only Notice Banner */}
      {isOperator && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <div className="text-xs sm:text-sm">
            <span className="font-semibold">Operator View Only:</span> You have view-only access. Only administrators can invite new users, modify roles, or delete staff members.
          </div>
        </div>
      )}

      {/* Main Content Card (Matching PatientsTab and DoctorsTab Theme) */}
      <div className="p-6 rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-sm space-y-6">
        {/* Error / Success Notifications */}
        {error && (
          <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-xs font-semibold hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {successMessage && (
          <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
            <button
              onClick={() => setSuccessMessage(null)}
              className="text-xs font-semibold hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Filter and Search Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-2">
          <div className="sm:col-span-8 relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#a29bc2]" />
            <input
              type="text"
              placeholder="Search staff by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm text-[#150f26] dark:text-white placeholder:text-[#a29bc2] focus:outline-none focus:border-[#7c3aed] transition-colors"
            />
          </div>

          <div className="sm:col-span-4">
            <CustomSelect
              value={roleFilter}
              onChange={setRoleFilter}
              icon={<Filter className="h-3.5 w-3.5 text-[#7c3aed]" />}
              options={[
                { value: "all", label: "All Roles" },
                { value: "admin", label: "Admin (Full Access)" },
                { value: "operator", label: "Operator (View Only)" },
              ]}
            />
          </div>
        </div>

        {/* Staff Table */}
        {loading && users.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-[#625b7e]">
            <Loader2 className="h-8 w-8 animate-spin text-[#7c3aed]" />
            <span className="text-xs">Loading staff members...</span>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-16 text-center border-2 border-dashed border-[#e6e0f5] dark:border-[#2b2347] rounded-2xl p-8 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-purple-100 dark:bg-purple-950/50 text-[#7c3aed] grid place-items-center mx-auto">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#150f26] dark:text-white">
                No staff users found
              </h3>
              <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] mt-1 max-w-md mx-auto">
                {search || roleFilter !== "all"
                  ? "No staff users matched your search filters. Try adjusting the query or role filter."
                  : "No staff members allocated yet. Use the Invite button above to allocate operators."}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#fcfaff] dark:bg-white/[0.02] border-b border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] dark:text-[#a29bc2] uppercase font-semibold text-[11px] tracking-wider">
                <tr>
                  <th className="py-3.5 px-5">Staff User</th>
                  <th className="py-3.5 px-4">Role</th>
                  <th className="py-3.5 px-4">Permissions</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Joined / Created</th>
                  {!isOperator && <th className="py-3.5 px-5 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0ebfa] dark:divide-[#251e3e]">
                {filteredUsers.map((u) => {
                  const isAdmin = u.role === "admin";
                  const initial = (u.full_name || u.email || "U").charAt(0).toUpperCase();

                  return (
                    <tr
                      key={u.id}
                      className="hover:bg-[#fbf9ff] dark:hover:bg-white/[0.02] transition-colors"
                    >
                      {/* Name & Avatar */}
                      <td className="py-3.5 px-5 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-8 h-8 rounded-xl font-bold grid place-items-center text-xs shrink-0 ${
                              isAdmin
                                ? "bg-purple-100 dark:bg-purple-950/70 text-[#7c3aed] dark:text-purple-300"
                                : "bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-300"
                            }`}
                          >
                            {initial}
                          </div>
                          <div>
                            <div className="font-semibold text-[#150f26] dark:text-white">
                              {u.full_name || "Unnamed User"}
                            </div>
                            <div className="text-[11px] text-[#625b7e] dark:text-[#a29bc2]">
                              {u.email}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Role Badge */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                            isAdmin
                              ? "bg-purple-100 dark:bg-purple-950/60 text-[#7c3aed] dark:text-purple-300 border-purple-200 dark:border-purple-800"
                              : "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                          }`}
                        >
                          <Shield className="h-3 w-3" />
                          <span>{isAdmin ? "Admin" : "Operator (Default)"}</span>
                        </span>
                      </td>

                      {/* Permissions Description */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {isAdmin ? (
                          <span className="text-xs font-medium text-[#7c3aed] dark:text-purple-300">
                            Full Access (CRUDL)
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                            GET-only (View Only)
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium capitalize ${
                            u.status === "active"
                              ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                          }`}
                        >
                          {u.status || "active"}
                        </span>
                      </td>

                      {/* Created Date */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-[#625b7e] dark:text-[#a29bc2]">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : "N/A"}
                      </td>

                      {/* Actions */}
                      {!isOperator && (
                        <td className="py-3.5 px-5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(u)}
                              className="p-1.5 rounded-lg text-[#625b7e] hover:text-[#7c3aed] hover:bg-purple-50 dark:hover:bg-purple-950/40 transition-colors"
                              title="Edit User"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRequestDelete(u)}
                              disabled={deletingUserId === u.id}
                              className="p-1.5 rounded-lg text-[#625b7e] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors disabled:opacity-40"
                              title="Delete User"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* =========================================================================
          MODAL 1: INVITE / ADD USER MODAL (PURPLE & LIGHT/DARK THEME)
          ========================================================================= */}
      {isInviteModalOpen &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-lg rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto space-y-5">
              <div className="flex items-center justify-between pb-4 border-b border-[#e6e0f5] dark:border-[#2b2347]">
                <div>
                  <h3 className="text-base font-bold text-[#150f26] dark:text-white flex items-center gap-2">
                    <UserPlus className="h-4 w-4 text-[#7c3aed]" />
                    <span>Invite / Allocate New User</span>
                  </h3>
                  <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                    New users default to the <span className="font-semibold text-[#7c3aed]">Operator</span> role with view-only permissions.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsInviteModalOpen(false)}
                  className="p-1.5 rounded-xl text-[#625b7e] hover:text-[#150f26] dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5"
                >
                  ✕
                </button>
              </div>

              {/* Note about direct password */}
              <div className="p-3.5 rounded-2xl bg-purple-50/70 dark:bg-purple-950/30 border border-purple-100 dark:border-purple-900/30 text-xs flex items-start gap-2.5 text-[#7c3aed] dark:text-purple-300">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <strong>Direct Password Setup:</strong> Email dispatch is currently paused until SMTP is set in <code className="font-mono bg-purple-100 dark:bg-purple-900/50 px-1 py-0.5 rounded text-[11px]">.env</code>. You can set the password below manually or use the auto-generated password.
                </div>
              </div>

              {inviteResult && inviteResult.success ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/40 text-center space-y-2">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto" />
                    <h4 className="text-sm font-bold text-[#150f26] dark:text-white">
                      User Successfully Created!
                    </h4>
                    <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                      The user has been allocated with role{" "}
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        {inviteResult.user?.role}
                      </span>.
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] space-y-2">
                    <div className="text-xs font-semibold text-[#150f26] dark:text-white">
                      Staff Credentials:
                    </div>
                    <div className="flex items-center justify-between text-xs bg-white dark:bg-black/30 p-2.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347]">
                      <span className="text-[#625b7e] dark:text-[#a29bc2]">Email:</span>
                      <span className="font-mono font-semibold text-[#150f26] dark:text-white">
                        {inviteResult.user?.email}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs bg-white dark:bg-black/30 p-2.5 rounded-xl border border-[#e6e0f5] dark:border-[#2b2347]">
                      <span className="text-[#625b7e] dark:text-[#a29bc2]">Password:</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          {inviteResult.tempPassword}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(inviteResult.tempPassword || "")}
                          className="p-1 rounded text-[#625b7e] hover:text-[#7c3aed]"
                          title="Copy Password"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsInviteModalOpen(false);
                        setInviteResult(null);
                      }}
                      className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-[#7c3aed] to-[#9333ea] text-white hover:brightness-105 shadow-md shadow-purple-600/30"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleInviteSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#150f26] dark:text-white mb-1">
                      Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Rahul Sharma"
                      value={inviteForm.full_name}
                      onChange={(e) => setInviteForm({ ...inviteForm, full_name: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#150f26] dark:text-white mb-1">
                      Email Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="e.g. operator@hospital.com"
                      value={inviteForm.email}
                      onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#150f26] dark:text-white mb-1">
                      Assigned Role
                    </label>
                    <CustomSelect
                      value={inviteForm.role || "operator"}
                      onChange={(val) => setInviteForm({ ...inviteForm, role: val as UserRole })}
                      options={[
                        { value: "operator", label: "Operator (Default - GET / View Only)" },
                        { value: "admin", label: "Admin (Full Access CRUDL)" },
                      ]}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-[#150f26] dark:text-white">
                        Password <span className="text-red-500">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={handleGeneratePasswordForInvite}
                        className="text-xs text-[#7c3aed] dark:text-purple-300 hover:underline flex items-center gap-1 font-semibold"
                      >
                        <Key className="h-3 w-3" /> Auto-generate
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        required
                        placeholder="Enter or generate password"
                        value={inviteForm.password || ""}
                        onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })}
                        className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm text-[#150f26] dark:text-white font-mono focus:outline-none focus:border-[#7c3aed]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a29bc2] hover:text-[#150f26] dark:hover:text-white"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#e6e0f5] dark:border-[#2b2347]">
                    <button
                      type="button"
                      onClick={() => setIsInviteModalOpen(false)}
                      className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[#625b7e] hover:text-[#150f26] dark:hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={inviteSubmitting}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-[#7c3aed] to-[#9333ea] text-white hover:brightness-105 shadow-md shadow-purple-600/30 disabled:opacity-50"
                    >
                      {inviteSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <span>{inviteSubmitting ? "Allocating..." : "Create / Allocate User"}</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>,
          document.body
        )}

      {/* =========================================================================
          MODAL 2: EDIT USER MODAL (PATCH) (PURPLE & LIGHT/DARK THEME)
          ========================================================================= */}
      {isEditModalOpen &&
        editingUser &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-lg rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto space-y-5">
              <div className="flex items-center justify-between pb-4 border-b border-[#e6e0f5] dark:border-[#2b2347]">
                <div>
                  <h3 className="text-base font-bold text-[#150f26] dark:text-white flex items-center gap-2">
                    <Edit3 className="h-4 w-4 text-[#7c3aed]" />
                    <span>Edit User: {editingUser.email}</span>
                  </h3>
                  <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                    Update name, role permissions, or reset account password.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="p-1.5 rounded-xl text-[#625b7e] hover:text-[#150f26] dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleEditSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#150f26] dark:text-white mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    placeholder="Full Name"
                    value={editForm.full_name}
                    onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm text-[#150f26] dark:text-white focus:outline-none focus:border-[#7c3aed]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#150f26] dark:text-white mb-1">
                    Role & Permissions
                  </label>
                  <CustomSelect
                    value={editForm.role}
                    onChange={(val) => setEditForm({ ...editForm, role: val as UserRole })}
                    options={[
                      { value: "operator", label: "Operator (View Only - GET Only)" },
                      { value: "admin", label: "Admin (Full Access - CRUDL)" },
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#150f26] dark:text-white mb-1">
                    Account Status
                  </label>
                  <CustomSelect
                    value={editForm.status}
                    onChange={(val) => setEditForm({ ...editForm, status: val as any })}
                    options={[
                      { value: "active", label: "Active" },
                      { value: "suspended", label: "Suspended" },
                      { value: "inactive", label: "Inactive" },
                    ]}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-[#150f26] dark:text-white">
                      Reset Password (Optional)
                    </label>
                    <button
                      type="button"
                      onClick={handleGeneratePasswordForEdit}
                      className="text-xs text-[#7c3aed] dark:text-purple-300 hover:underline flex items-center gap-1 font-semibold"
                    >
                      <Key className="h-3 w-3" /> Auto-generate
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={editShowPassword ? "text" : "password"}
                      placeholder="Leave blank to keep existing password"
                      value={editForm.password || ""}
                      onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                      className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm text-[#150f26] dark:text-white font-mono focus:outline-none focus:border-[#7c3aed]"
                    />
                    <button
                      type="button"
                      onClick={() => setEditShowPassword(!editShowPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a29bc2] hover:text-[#150f26] dark:hover:text-white"
                    >
                      {editShowPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#e6e0f5] dark:border-[#2b2347]">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[#625b7e] hover:text-[#150f26] dark:hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={editSubmitting}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-[#7c3aed] to-[#9333ea] text-white hover:brightness-105 shadow-md shadow-purple-600/30 disabled:opacity-50"
                  >
                    {editSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>{editSubmitting ? "Saving..." : "Save Changes"}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* =========================================================================
          MODAL 3: DELETE CONFIRMATION MODAL
          ========================================================================= */}
      {userToDelete &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-md rounded-[24px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] p-6 shadow-2xl relative space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-950/70 text-red-500 grid place-items-center shrink-0">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#150f26] dark:text-white">
                    Remove Staff Member?
                  </h3>
                  <p className="text-xs text-[#625b7e] dark:text-[#a29bc2]">
                    This user will immediately lose access to {hospitalName}.
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs space-y-1">
                <div className="font-semibold text-[#150f26] dark:text-white">
                  {userToDelete.full_name || "Staff User"}
                </div>
                <div className="text-[#625b7e] dark:text-[#a29bc2]">
                  {userToDelete.email}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#e6e0f5] dark:border-[#2b2347]">
                <button
                  type="button"
                  onClick={() => setUserToDelete(null)}
                  disabled={deletingUserId !== null}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[#625b7e] hover:text-[#150f26] dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={deletingUserId !== null}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-600/30 disabled:opacity-50 transition-colors"
                >
                  {deletingUserId !== null && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>{deletingUserId !== null ? "Removing..." : "Yes, Remove User"}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default UsersTab;
