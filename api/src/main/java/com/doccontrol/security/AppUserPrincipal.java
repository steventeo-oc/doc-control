package com.doccontrol.security;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.Set;

/**
 * Spring Security principal carrying our application user's id, so services
 * can resolve the actual User entity (for ownership and audit_log.performed_by).
 */
public final class AppUserPrincipal implements UserDetails {

    private final Integer userId;
    private final String email;
    private final String passwordHash;
    private final boolean active;
    private final Set<GrantedAuthority> authorities;

    public AppUserPrincipal(Integer userId, String email, String passwordHash, boolean active,
                            Set<GrantedAuthority> authorities) {
        this.userId = userId;
        this.email = email;
        this.passwordHash = passwordHash;
        this.active = active;
        this.authorities = authorities;
    }

    public Integer getUserId() {
        return userId;
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return authorities;
    }

    @Override
    public String getPassword() {
        return passwordHash;
    }

    @Override
    public String getUsername() {
        return email;
    }

    @Override
    public boolean isEnabled() {
        return active;
    }

    @Override
    public boolean isAccountNonExpired() {
        return true;
    }

    @Override
    public boolean isAccountNonLocked() {
        return true;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }
}
