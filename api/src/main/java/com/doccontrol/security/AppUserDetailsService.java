package com.doccontrol.security;

import com.doccontrol.identity.User;
import com.doccontrol.identity.UserRepository;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class AppUserDetailsService implements UserDetailsService {

    private final UserRepository userRepository;

    public AppUserDetailsService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Override
    public UserDetails loadUserByUsername(String email) throws UsernameNotFoundException {
        User user = userRepository.findByEmailIgnoreCase(email)
                .orElseThrow(() -> new UsernameNotFoundException("No user with email " + email));

        // Authorities are case-normalized (ROLE_ADMIN) so hasRole("ADMIN")
        // matches regardless of the role's display name ("Admin").
        Set<GrantedAuthority> authorities = user.getRoles().stream()
                .map(userRole -> new SimpleGrantedAuthority(
                        "ROLE_" + userRole.getRole().getName().toUpperCase(Locale.ROOT)))
                .collect(Collectors.toSet());

        return new AppUserPrincipal(user.getId(), user.getEmail(), user.getPasswordHash(),
                user.isActive(), authorities);
    }
}
